# @layered-loader/sqs

SNS/SQS remote-invalidation adapter for [`layered-loader`](https://github.com/kibertoad/layered-loader).

This package provides:

- **Notification publishers and consumers** that fan cache invalidations out across a cluster via an SNS topic and per-instance SQS queues — a drop-in alternative to the built-in Redis adapter for AWS-native deployments.
- **Flexible invalidation triggers** that subscribe to an *existing* upstream SNS topic or SQS queue (one that knows nothing about the caching layer) and translate domain events such as `user.updated` into cache invalidations propagated through any notification publisher (Redis or SNS/SQS).
- **Queue-lifecycle helpers** (`reapStaleQueues`, opt-in `deleteQueueOnClose` / heartbeat tagging) for deployments where per-instance SQS queue churn would otherwise be a problem.

The implementation is built on top of [`@message-queue-toolkit/sns`](https://github.com/kibertoad/message-queue-toolkit) and is tested against [fauxqs](https://github.com/kibertoad/fauxqs), an in-process SNS/SQS emulator.

> **Prefer Redis pub/sub when you can.** This package exists to support AWS-native deployments and upstream-event consumption, but operationally Redis pub/sub is simpler — no per-instance queues, no lifecycle management, no AWS quotas to manage. If your only reason to be here is "I have an upstream SNS topic to consume", the **[recommended hybrid pattern](#recommended-pattern-redis-publisher--sqs-trigger)** is Redis publisher + SQS trigger with a shared queue. You skip the queue-lifecycle problem entirely.

## Contents

- [Installation](#installation)
- [Picking your shape](#picking-your-shape)
- [Quick start: notification pair](#quick-start-notification-pair)
- [Group notification pair](#group-notification-pair)
- [Locator vs creation config](#locator-vs-creation-config)
- [How invalidation flows through SNS/SQS](#how-invalidation-flows-through-snssqs)
- [Self-message filtering and `serverUuid`](#self-message-filtering-and-serveruuid)
- [Queue lifecycle management](#queue-lifecycle-management)
  - [Why queue churn happens](#why-queue-churn-happens)
  - [Strategy 1: stable queue names](#strategy-1-stable-queue-names)
  - [Strategy 2: Redis publisher + SQS trigger hybrid](#strategy-2-redis-publisher--sqs-trigger-hybrid)
  - [Strategy 3: graceful shutdown cleanup](#strategy-3-graceful-shutdown-cleanup)
  - [Strategy 4: heartbeat + reaper](#strategy-4-heartbeat--reaper)
  - [Strategy 5: EventBridge + Lambda](#strategy-5-eventbridge--lambda)
- [Flexible invalidation triggers](#flexible-invalidation-triggers)
  - [Recommended pattern: Redis publisher + SQS trigger](#recommended-pattern-redis-publisher--sqs-trigger)
  - [Triggering from an existing SNS topic](#triggering-from-an-existing-sns-topic)
  - [Triggering from an existing SQS queue](#triggering-from-an-existing-sqs-queue)
  - [Group triggers](#group-triggers)
  - [Resolver semantics](#resolver-semantics)
  - [The trigger-publisher rule](#the-trigger-publisher-rule)
  - [Error handling and retries](#error-handling-and-retries)
- [Testing with fauxqs](#testing-with-fauxqs)
- [API reference](#api-reference)

## Installation

```bash
npm install @layered-loader/sqs layered-loader
# Plus the AWS SDK clients and message-queue-toolkit (peer deps):
npm install \
  @aws-sdk/client-sns @aws-sdk/client-sqs @aws-sdk/client-sts \
  @lokalise/node-core \
  @message-queue-toolkit/core @message-queue-toolkit/sns @message-queue-toolkit/sqs \
  zod
```

Node 20+ is required.

## Picking your shape

There are three deployment shapes you can build with this package, and they have very different operational profiles. Pick deliberately:

| Shape | Publisher | Trigger source | Queue churn | When to use |
| --- | --- | --- | --- | --- |
| **A. Pure Redis** (use [`layered-loader`](https://github.com/kibertoad/layered-loader#update-notifications) directly, not this package) | Redis pub/sub | (none, or Redis-driven) | None | Default. Use this whenever Redis is available. |
| **B. Pure SNS/SQS** | `SqsNotificationPublisher` | per-instance SQS queues | **Yes** — needs lifecycle management | Only when Redis is not available at all. |
| **C. Hybrid: Redis publisher + SQS trigger** ⭐ | Redis pub/sub | `SqsInvalidationTrigger` on a **shared** queue | None | When you have AWS upstream events to consume but Redis is available for cluster fanout. **Recommended for the upstream-events use case.** |

> Shape **C** is almost always the right answer if you have AWS upstream events and Redis. It gives you AWS-native event ingestion *and* the operational simplicity of Redis fanout. See [Recommended pattern: Redis publisher + SQS trigger](#recommended-pattern-redis-publisher--sqs-trigger).

If you settle on shape **B** (no Redis at all), read [Queue lifecycle management](#queue-lifecycle-management) before going to production. The per-instance queue model leaks queues and SNS subscriptions if you do not address it.

## Quick start: notification pair

The simplest setup mirrors the built-in Redis pair: each application instance gets a `publisher` (sends invalidations to a shared SNS topic) and a `consumer` (reads its own SQS queue subscribed to that topic and applies invalidations to its in-memory cache).

```ts
import { SNSClient } from '@aws-sdk/client-sns'
import { SQSClient } from '@aws-sdk/client-sqs'
import { STSClient } from '@aws-sdk/client-sts'
import { globalLogger, NoopObservabilityManager } from '@lokalise/node-core'
import { SnsConsumerErrorResolver } from '@message-queue-toolkit/sns'
import { Loader } from 'layered-loader'
import { createNotificationPair } from '@layered-loader/sqs'
import type { User } from './types'

const region = 'us-east-1'
const snsClient = new SNSClient({ region })
const sqsClient = new SQSClient({ region })
const stsClient = new STSClient({ region })

const errorReporter = { report: () => {} }

const { publisher: notificationPublisher, consumer: notificationConsumer } =
  createNotificationPair<User>({
    publisher: {
      dependencies: { snsClient, stsClient, logger: globalLogger, errorReporter },
      creationConfig: { topic: { Name: 'user-cache-invalidations' } },
    },
    consumer: {
      dependencies: {
        snsClient,
        sqsClient,
        stsClient,
        logger: globalLogger,
        errorReporter,
        consumerErrorResolver: new SnsConsumerErrorResolver(),
        transactionObservabilityManager: new NoopObservabilityManager(),
      },
      creationConfig: {
        topic: { Name: 'user-cache-invalidations' },
        // Each instance MUST use a unique queue name (e.g. include the host id):
        queue: { QueueName: `user-cache-invalidations-${process.env.HOSTNAME}` },
      },
    },
  })

const userLoader = new Loader<User>({
  inMemoryCache: { ttlInMsecs: 1000 * 60 * 5 },
  asyncCache: yourAsyncCache,
  notificationConsumer,
  notificationPublisher,
})

await userLoader.init()
await userLoader.invalidateCacheFor('123') // fans out to every other instance
```

Each consumer needs its **own** SQS queue subscribed to the shared topic; SNS handles the fan-out. If two instances share a queue, only one of them will receive each invalidation message.

## Group notification pair

For `GroupLoader`, use `createGroupNotificationPair` with the same shape:

```ts
import { GroupLoader } from 'layered-loader'
import { createGroupNotificationPair } from '@layered-loader/sqs'

const { publisher: notificationPublisher, consumer: notificationConsumer } =
  createGroupNotificationPair<User>({
    publisher: { dependencies, creationConfig: { topic: { Name: 'tenant-cache-invalidations' } } },
    consumer: {
      dependencies: consumerDependencies,
      creationConfig: {
        topic: { Name: 'tenant-cache-invalidations' },
        queue: { QueueName: `tenant-cache-invalidations-${process.env.HOSTNAME}` },
      },
    },
  })

const userLoader = new GroupLoader<User>({
  inMemoryCache: { ttlInMsecs: 1000 * 60 * 5 },
  asyncCache: yourAsyncCache,
  notificationConsumer,
  notificationPublisher,
})

await userLoader.invalidateCacheFor('user-1', 'tenant-A')
```

## Locator vs creation config

Both publisher and consumer accept a discriminated config:

| Field | Behaviour |
| --- | --- |
| `creationConfig` | Auto-creates the resource (`topic`, `queue`, `subscription`) on `subscribe()` if it does not exist. |
| `locatorConfig`  | Reuses pre-provisioned resources. Throws if they are missing. |

For a consumer in `locatorConfig` mode, you must supply enough information to resolve the topic, queue, and subscription:

```ts
consumer: {
  dependencies: consumerDependencies,
  locatorConfig: {
    topicArn: 'arn:aws:sns:us-east-1:000000000000:user-cache-invalidations',
    queueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/cache-q-host-1',
    subscriptionArn: 'arn:aws:sns:...:subscription/...',
  },
}
```

You can grab those identifiers off a previously-initialised consumer/publisher:

```ts
await pair.publisher.subscribe()
await pair.consumer.subscribe()
console.log(pair.publisher.topicArn)
console.log(pair.consumer.subscriptionArn, pair.consumer.queueUrl)
```

If you need to override defaults of the SNS subscription (filter policy, raw delivery, etc.), pass `subscriptionConfig: SqsSubscriptionOptions` to the consumer config.

## How invalidation flows through SNS/SQS

```
┌──────────────────┐                    SNS topic                     ┌──────────────────┐
│  Instance A      │   publisher ────────────────────────────▶  ┌──── │   Instance B     │
│  Loader          │                                              │ ───┴── consumer.delete(key)
│                  │   consumer ──── (own queue, self-skip)       │
└──────────────────┘                                              │ ───┬── consumer.delete(key)
                                                                  └──── │   Instance C    │
                                                                        └──────────────────┘
```

Each `Loader.invalidateCacheFor(...)` call publishes a JSON command (`DELETE`, `DELETE_MANY`, `SET`, `CLEAR`) to the SNS topic. SNS fan-outs to every subscribed SQS queue, and each consumer applies the command to its local in-memory cache.

## Self-message filtering and `serverUuid`

Every published command carries an `originUuid`. A consumer skips a command whose `originUuid` matches its own `serverUuid`, preventing instance A from re-applying its own invalidations bouncing back through SNS.

`createNotificationPair` (and `createGroupNotificationPair`) generate one `serverUuid` shared by both the publisher and the consumer it returns. You can override it with the `serverUuid` field if you need stable identifiers across restarts (e.g. when locating an existing subscription).

## Queue lifecycle management

### Why queue churn happens

The per-instance queue model that gives you proper fanout (see [How invalidation flows through SNS/SQS](#how-invalidation-flows-through-snssqs)) has a flip side: **SQS queues persist until explicitly deleted**. AMQP-style `auto-delete` / `exclusive` queues do not exist in SQS. There is no "TTL on the queue itself", only `MessageRetentionPeriod` on messages within it.

In practice this means every restart of a pod with a random `HOSTNAME` leaks one queue + one SNS subscription. Over a few weeks of deploys you can accumulate thousands of dead queues and bump into AWS quotas (12.5k subscriptions/topic, 1M queues/account). Messages in orphan queues expire after `MessageRetentionPeriod` (default 4 days, max 14), but the queue itself persists.

Pick **one** of the five strategies below, in roughly preference order:

### Strategy 1: stable queue names

Simplest, zero plumbing. If your deployment gives you stable identifiers — Kubernetes StatefulSet pod ordinals (`web-0`, `web-1`, …), ECS service with placement constraints, fixed worker slots — use them in the queue name:

```ts
const slotId = process.env.POD_ORDINAL // e.g. "0", "1", "2" from a StatefulSet
const queueName = `user-cache-${slotId}` // recycled on restart
```

Restarted pods reuse the same queue. Zero churn. Nothing to clean up. This is the right answer when your deployment model supports it.

### Strategy 2: Redis publisher + SQS trigger hybrid

If you arrived at this package because you need to consume AWS upstream events, the **hybrid pattern in [Flexible invalidation triggers](#recommended-pattern-redis-publisher--sqs-trigger) eliminates the per-instance queue problem entirely** — the trigger reads a single shared queue (competing-consumer semantics), and Redis pub/sub handles fanout. No churn, no cleanup code.

### Strategy 3: graceful shutdown cleanup

If you cannot get stable queue names, the next-cheapest option is to opt into shutdown-time cleanup. The consumer's `close()` will then issue `Unsubscribe` (SNS) and `DeleteQueue` (SQS) after stopping the message loop:

```ts
import { createNotificationPair } from '@layered-loader/sqs'

const { publisher, consumer } = createNotificationPair<User>({
  publisher: { dependencies: pubDeps, creationConfig: { topic: { Name: 'user-cache-invalidations' } } },
  consumer: {
    dependencies: consumerDeps,
    creationConfig: {
      topic: { Name: 'user-cache-invalidations' },
      queue: { QueueName: `user-cache-invalidations-${process.env.HOSTNAME}` },
    },
    lifecycle: {
      deleteQueueOnClose: true,
      unsubscribeOnClose: true,
      onCleanupError: (err, step) => log.warn({ err, step }, 'cleanup failed'),
    },
  },
})

// Wire to SIGTERM:
const shutdown = async () => {
  await consumer.close()
  await publisher.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
```

Cleanup is **best-effort**. Missing queues / subscriptions are treated as success (idempotent). Errors invoke the optional `onCleanupError` hook so you can log them, but they do not block shutdown.

**Limitations:** the handler does not run on `kill -9`, OOM kill, or hard pod evictions. For those, combine this with the heartbeat reaper (strategy 4).

### Strategy 4: heartbeat + reaper

Robust against any termination mode, at the cost of one background tag write per minute and a scheduled cleanup job. Each live consumer tags its own queue with `layered-loader:heartbeat=<unix-ms>` on a timer; a periodic reaper deletes queues whose tag is older than the threshold.

This is a classic lease/heartbeat-and-sweep pattern — the consumer continuously asserts liveness via a per-queue tag, and an out-of-band reaper deletes anything whose lease has expired. (For comparison, the AWS Java [Temporary Queue Client](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-temporary-queues.html) addresses the same problem differently — virtual queues multiplexed onto a single host queue — but the failure modes the heartbeat-and-sweep approach guards against are well-understood.)

**1) Enable the heartbeat on each consumer:**

```ts
const { publisher, consumer } = createNotificationPair<User>({
  publisher: { dependencies: pubDeps, creationConfig: { topic: { Name: 'user-cache-invalidations' } } },
  consumer: {
    dependencies: consumerDeps,
    creationConfig: {
      topic: { Name: 'user-cache-invalidations' },
      queue: { QueueName: `user-cache-invalidations-${process.env.HOSTNAME}` },
    },
    lifecycle: {
      heartbeat: {
        intervalMs: 60_000, // default
        errorHandler: (err) => log.warn({ err }, 'heartbeat write failed'),
      },
    },
  },
})
```

**2) Run `reapStaleQueues` on a schedule** (cron, Lambda, ECS scheduled task — somewhere with credentials for `sqs:ListQueues`, `sqs:ListQueueTags`, `sqs:GetQueueAttributes`, `sqs:DeleteQueue`, and optionally `sns:ListSubscriptionsByTopic` + `sns:Unsubscribe`):

```ts
import { reapStaleQueues } from '@layered-loader/sqs'

const result = await reapStaleQueues({
  sqsClient,
  snsClient,                  // optional — when set, also removes orphan subscriptions
  topicArn,                   // required if snsClient is set
  queueNamePrefix: 'user-cache-invalidations-',
  idleThresholdMs: 5 * 60_000, // 5 min — should be >= 3x heartbeat interval
  dryRun: false,              // set to true on the first run against real account
  onDecision: ({ queueUrl, decision, reason }) => log.info({ queueUrl, decision, reason }),
})

log.info({ deleted: result.deleted.length, skipped: result.skipped.length }, 'reap complete')
```

`reapStaleQueues` returns `{ deleted, skipped, unsubscribed, errors }`. It is idempotent and continues past individual errors. Pick `idleThresholdMs` ≥ 3× `heartbeat.intervalMs` to tolerate transient SQS API failures without false positives.

**How heartbeat-less queues are handled.** A queue with no heartbeat tag whose `CreatedTimestamp` is older than the threshold is also reaped — this covers queues from before heartbeat tagging was enabled, or pre-existing manual queues. A queue with no heartbeat tag *younger* than the threshold is left alone (a live consumer may not have written its first beat yet).

### Strategy 5: EventBridge + Lambda

For large ECS/Fargate deployments where containers should not hold queue-management permissions, the canonical AWS-blessed pattern is to drive lifecycle from outside the application: an EventBridge rule on ECS `RUNNING` events triggers a Lambda that creates the queue, and a rule on `STOPPED` triggers a cleanup Lambda. See the AWS Compute Blog: [Building dynamic Amazon SNS subscriptions for auto-scaling container workloads](https://aws.amazon.com/blogs/compute/building-dynamic-amazon-sns-subscriptions-for-auto-scaling-container-workloads/).

This is the most robust option but lives entirely outside the library — beyond the helpers above, the package does not orchestrate it.

## Flexible invalidation triggers

A *trigger* lets you treat any upstream messaging system as a source of cache-invalidation events without that system knowing the cache exists. The trigger:

1. Subscribes to a queue or topic you do not own.
2. Validates each message with a Zod schema.
3. Runs your **resolver** to extract entity ids (and optionally a group).
4. Forwards the resulting actions through a configured `NotificationPublisher`, fanning them out to every cache instance.

The actions and resolver shape are transport-agnostic — the same `InvalidationResolver`, `InvalidationAction`, dispatch helpers, and `InvalidationTrigger` interface can power future RabbitMQ / Kafka / Pub/Sub adapters. The SNS/SQS adapters live in this package.

### Recommended pattern: Redis publisher + SQS trigger

This is shape **C** from [Picking your shape](#picking-your-shape) and the recommended setup whenever you have both AWS upstream events and Redis available. The trigger's `publisher` is typed as `NotificationPublisher<T>` — nothing requires it to be a `SqsNotificationPublisher`. Pass layered-loader's built-in Redis publisher and the trigger queue can be **shared across all instances** (no per-instance queue, no churn):

```ts
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { createNotificationPair, Loader, RedisNotificationPublisher } from 'layered-loader'
import { SqsInvalidationTrigger } from '@layered-loader/sqs'

const USER_EVENT_SCHEMA = z.object({
  type: z.literal('user.updated'),
  userId: z.string(),
})

const redisOptions = { host: 'redis', port: 6379 }

// 1. The cache cluster's own invalidation pair — pure Redis pub/sub.
const { publisher: notificationPublisher, consumer: notificationConsumer } =
  createNotificationPair<User>({
    channel: 'user-cache-invalidations',
    publisherRedis: new Redis(redisOptions),
    consumerRedis: new Redis(redisOptions),
  })

const userLoader = new Loader<User>({
  inMemoryCache: { ttlInMsecs: 1000 * 60 * 5 },
  asyncCache: yourAsyncCache,
  notificationConsumer,
  notificationPublisher,
})
await userLoader.init()

// 2. A dedicated Redis publisher for the trigger output, with a distinct
//    serverUuid so the local consumer treats trigger messages as foreign
//    (it skips messages whose originUuid matches its own). Constructed
//    directly rather than via createNotificationPair to avoid spinning up
//    a second, unused Redis subscriber connection.
const triggerPublisher = new RedisNotificationPublisher<User>(
  new Redis(redisOptions),
  { channel: 'user-cache-invalidations', serverUuid: randomUUID() },
)

// 3. The trigger, subscribed to an upstream domain-event topic via a SHARED
//    SQS queue (note: no ${HOSTNAME} suffix — SQS competing-consumer semantics
//    ensure each upstream event is processed by exactly one instance).
const trigger = new SqsInvalidationTrigger({
  sourceType: 'sns-topic',
  dependencies: consumerDeps,
  creationConfig: {
    topic: { Name: 'domain-events.users' },                  // upstream service's topic
    queue: { QueueName: 'user-cache-invalidation-trigger' }, // SHARED across all instances
  },
  messageSchema: USER_EVENT_SCHEMA,
  publisher: triggerPublisher,
  resolver: (msg) => ({ kind: 'delete', key: msg.userId }),
})

await trigger.start()
```

What you get:

- **One** SQS queue regardless of pod count → no churn, no lifecycle plumbing needed (`lifecycle` options unused, `reapStaleQueues` unused).
- AWS-native ingestion of upstream domain events.
- Redis pub/sub for cluster fanout — sub-ms latency, no per-instance setup.
- Natural failure isolation: if a pod crashes mid-message, SQS visibility timeout returns the message to the queue and another pod picks it up.

If your upstream events have meaningful per-entity ordering, use an SQS FIFO queue (`QueueName: 'user-cache-invalidation-trigger.fifo'` plus `FifoQueue: 'true'` in the queue attributes). Otherwise a standard queue is appropriate.

### Triggering from an existing SNS topic

Use `sourceType: 'sns-topic'` with either creation or locator config. The trigger creates (or reuses) an SQS queue and subscribes it to the upstream topic.

```ts
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  createNotificationPair,
  SqsInvalidationTrigger,
  SqsNotificationPublisher,
} from '@layered-loader/sqs'

const USER_EVENT_SCHEMA = z.object({
  type: z.enum(['user.updated', 'user.deleted', 'user.bulk-updated']),
  userId: z.string().optional(),
  userIds: z.array(z.string()).optional(),
})

// 1. The cache cluster's own invalidation pair (same as any deployment):
const cachePair = createNotificationPair<User>({
  publisher: { dependencies: pubDeps, creationConfig: { topic: { Name: 'user-cache-invalidations' } } },
  consumer:  {
    dependencies: consumerDeps,
    creationConfig: {
      topic: { Name: 'user-cache-invalidations' },
      queue: { QueueName: `user-cache-invalidations-${process.env.HOSTNAME}` },
    },
  },
})

// 2. A separate publisher dedicated to trigger-emitted messages.
//    Its serverUuid MUST be different from cachePair's so the local consumer
//    treats trigger messages as foreign and applies them.
const triggerPublisher = new SqsNotificationPublisher<User>({
  serverUuid: randomUUID(),
  dependencies: pubDeps,
  locatorConfig: { topicName: 'user-cache-invalidations' },
})

// 3. The trigger itself, subscribed to an upstream domain-event topic
//    owned by another service:
const trigger = new SqsInvalidationTrigger<z.infer<typeof USER_EVENT_SCHEMA>>({
  sourceType: 'sns-topic',
  dependencies: consumerDeps,
  creationConfig: {
    topic: { Name: 'domain-events.users' }, // owned by an upstream service
    queue: { QueueName: `cache-trigger-${process.env.HOSTNAME}` },
  },
  messageSchema: USER_EVENT_SCHEMA,
  publisher: triggerPublisher,
  resolver: (msg) => {
    switch (msg.type) {
      case 'user.updated':
      case 'user.deleted':
        return msg.userId ? { kind: 'delete', key: msg.userId } : null
      case 'user.bulk-updated':
        return msg.userIds?.length
          ? { kind: 'deleteMany', keys: msg.userIds }
          : null
    }
  },
})

await trigger.start()
```

### Triggering from an existing SQS queue

If the upstream system writes directly to an SQS queue (no SNS topic in the middle), use `sourceType: 'sqs-queue'`:

```ts
import { SqsInvalidationTrigger } from '@layered-loader/sqs'

const trigger = new SqsInvalidationTrigger<DomainEvent>({
  sourceType: 'sqs-queue',
  dependencies: sqsConsumerDeps,
  locatorConfig: {
    queueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/domain-events',
  },
  messageSchema: DOMAIN_EVENT_SCHEMA,
  publisher: triggerPublisher,
  resolver: (msg) => /* ... */,
})

await trigger.start()
```

The pure-SQS source uses `@message-queue-toolkit/sqs`'s consumer directly and does not require SNS / STS clients in its dependencies.

### Group triggers

`SqsGroupInvalidationTrigger` mirrors the flat trigger but emits `GroupInvalidationAction`s:

```ts
import { SqsGroupInvalidationTrigger, SqsGroupNotificationPublisher } from '@layered-loader/sqs'

const triggerPublisher = new SqsGroupNotificationPublisher<User>({
  serverUuid: randomUUID(),
  dependencies: pubDeps,
  locatorConfig: { topicName: 'tenant-cache-invalidations' },
})

const trigger = new SqsGroupInvalidationTrigger<TenantEvent>({
  sourceType: 'sns-topic',
  dependencies: consumerDeps,
  creationConfig: {
    topic: { Name: 'tenant-events' },
    queue: { QueueName: `tenant-trigger-${process.env.HOSTNAME}` },
  },
  messageSchema: TENANT_EVENT_SCHEMA,
  publisher: triggerPublisher,
  resolver: (msg) => {
    if (msg.type === 'tenant.purged') return { kind: 'deleteGroup', group: msg.tenantId }
    if (msg.type === 'tenant.user.updated' && msg.userId) {
      return { kind: 'deleteFromGroup', key: msg.userId, group: msg.tenantId }
    }
    return null
  },
})

await trigger.start()
```

### Resolver semantics

A resolver receives the validated `TMessage` and returns:

- A single `InvalidationAction` / `GroupInvalidationAction` — applied immediately.
- An array of actions — applied sequentially, preserving emission order.
- `null` or `undefined` — skip the message (the source treats it as successfully processed).

Flat actions:

```ts
type InvalidationAction =
  | { kind: 'delete'; key: string }
  | { kind: 'deleteMany'; keys: readonly string[] }
  | { kind: 'set'; key: string; value: unknown }
  | { kind: 'clear' }
```

Group actions:

```ts
type GroupInvalidationAction =
  | { kind: 'deleteFromGroup'; key: string; group: string }
  | { kind: 'deleteGroup'; group: string }
  | { kind: 'clear' }
```

Resolvers may be `async`; the trigger awaits before publishing.

### The trigger-publisher rule

> **The trigger's publisher MUST have a `serverUuid` distinct from any local notification pair.**

Why: a `Loader` invalidates its own in-memory cache *before* publishing, so the pair's consumer is configured to skip messages with a matching `originUuid` (otherwise the pair would re-process its own invalidations). Trigger-emitted invalidations come from outside any Loader, so the pair's consumer must treat them as foreign and apply them. Sharing `serverUuid` means the local in-memory cache silently misses every trigger-driven invalidation.

In practice: build the trigger publisher with `randomUUID()` even when it points at the same SNS topic as your `createNotificationPair` publisher. The example snippets above all show this pattern.

### Error handling and retries

If the resolver or publish step throws, the trigger:

1. Invokes the optional `errorHandler(err, channel)` for observability.
2. Re-throws so `message-queue-toolkit` can apply its standard SQS retry / dead-letter behaviour.

For schema-violation errors, the message is failed by `message-queue-toolkit` before the resolver runs and goes back to the queue (and ultimately to a DLQ if you configured one). Configure DLQ on the trigger's queue creation config to bound retries.

### Lifecycle

```ts
const trigger = new SqsInvalidationTrigger({ ... })

await trigger.start() // idempotent; concurrent calls share one start
await trigger.stop()  // idempotent; awaits any in-flight start
await trigger.start() // restart is supported
```

## Testing with fauxqs

For local development and tests, swap the AWS SDK endpoint for [fauxqs](https://github.com/kibertoad/fauxqs). Two modes are useful in practice:

### In-process (recommended for tests)

Sub-second startup, no daemon required, isolated per test process. This package's own integration tests run this way — see `packages/sqs/test/globalSetup.ts`.

```ts
import { startFauxqs } from 'fauxqs'
import { SQSClient } from '@aws-sdk/client-sqs'

const server = await startFauxqs({ port: 0, logger: false })
const credentials = { accessKeyId: 'test', secretAccessKey: 'test' }
const region = 'us-east-1'

const sqsClient = new SQSClient({ endpoint: server.address, region, credentials })
// ...
await server.stop()
```

### Docker-compose (for app smoke testing)

The repository root's `docker-compose.yml` includes a `fauxqs` service on port `4566` for local app runs against a stable endpoint:

```bash
docker compose up fauxqs
```

Then point your AWS SDK clients at `http://localhost:4566`.

## API reference

### Notification pair

| Symbol | Purpose |
| --- | --- |
| `createNotificationPair<T>(config)` | Returns `{ publisher, consumer }` for flat-cache invalidation. |
| `createGroupNotificationPair<T>(config)` | Same, but for group caches. |
| `SqsNotificationPublisher<T>` | Lower-level constructor; useful for trigger publishers (independent UUID). |
| `SqsNotificationConsumer<T>` | Lower-level constructor; rarely used directly. |
| `SqsGroupNotificationPublisher<T>` / `SqsGroupNotificationConsumer<T>` | Group-cache equivalents. |
| `SqsSubscriptionOptions` | Type for `subscriptionConfig` overrides. |

### Triggers

| Symbol | Purpose |
| --- | --- |
| `SqsInvalidationTrigger<TMessage>` | Flat-cache trigger (SQS or SNS+SQS source). |
| `SqsGroupInvalidationTrigger<TMessage>` | Group-cache trigger. |
| `SqsTriggerSource` | Discriminated source config (`'sqs-queue'` or `'sns-topic'`, with `creationConfig` or `locatorConfig`). |
| `InvalidationAction` / `GroupInvalidationAction` | Action ADTs returned by resolvers. |
| `InvalidationResolver<TMessage, TAction>` | Resolver signature. |
| `InvalidationTrigger` | `start()` / `stop()` lifecycle interface. |
| `runFlatPipeline` / `runGroupPipeline` | Reusable resolver + dispatch helpers (transport-agnostic). |
| `applyFlatAction` / `applyGroupAction` | Apply a single resolved action to a publisher. |
| `AbstractSqsTrigger` | Base class for building custom SQS-based triggers. |
| `deriveTriggerChannelName` | Helper that derives a logical channel name from a source config. |

### Queue lifecycle

| Symbol | Purpose |
| --- | --- |
| `QueueLifecycleOptions` | Per-consumer config: `deleteQueueOnClose`, `unsubscribeOnClose`, `heartbeat`, `onCleanupError`. Pass under `consumer.lifecycle` in `createNotificationPair` (or directly to `SqsNotificationConsumer`). |
| `HeartbeatOptions` | `{ intervalMs?, errorHandler? }`. Cadence at which the consumer writes the `layered-loader:heartbeat` tag on its own queue. Default `60_000` ms. |
| `startQueueHeartbeat({ sqsClient, queueUrl, intervalMs?, errorHandler? })` | Lower-level: start a heartbeat loop for an arbitrary queue. Returns `{ stop() }`. |
| `reapStaleQueues({ sqsClient, snsClient?, topicArn?, queueNamePrefix, idleThresholdMs?, dryRun?, onDecision? })` | Scan-and-delete stale queues, plus optionally unsubscribe orphan SNS subscriptions. Returns `{ deleted, skipped, unsubscribed, errors }`. |
| `resolveQueueUrl(sqsClient, queueName)` | Convenience: resolve a queue URL by name, or `undefined` if missing. |
| `HEARTBEAT_TAG_KEY` | The tag key written by the heartbeat (`'layered-loader:heartbeat'`). |
| `DEFAULT_HEARTBEAT_INTERVAL_MS` / `DEFAULT_REAPER_IDLE_THRESHOLD_MS` | Default cadences (60s / 5min). |
