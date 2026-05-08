# @layered-loader/sqs

SNS/SQS remote-invalidation adapter for [`layered-loader`](https://github.com/kibertoad/layered-loader).

This package provides:

- **Notification publishers and consumers** that fan cache invalidations out across a cluster via an SNS topic and per-instance SQS queues — a drop-in alternative to the built-in Redis adapter for AWS-native deployments.
- **Flexible invalidation triggers** that subscribe to an *existing* upstream SNS topic or SQS queue (one that knows nothing about the caching layer) and translate domain events such as `user.updated` into cache invalidations propagated through your notification pair.

The implementation is built on top of [`@message-queue-toolkit/sns`](https://github.com/kibertoad/message-queue-toolkit) and is tested against [fauxqs](https://github.com/kibertoad/fauxqs), an in-process SNS/SQS emulator.

## Contents

- [Installation](#installation)
- [Quick start: notification pair](#quick-start-notification-pair)
- [Group notification pair](#group-notification-pair)
- [Locator vs creation config](#locator-vs-creation-config)
- [How invalidation flows through SNS/SQS](#how-invalidation-flows-through-snssqs)
- [Self-message filtering and `serverUuid`](#self-message-filtering-and-serveruuid)
- [Flexible invalidation triggers](#flexible-invalidation-triggers)
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

## Flexible invalidation triggers

A *trigger* lets you treat any upstream messaging system as a source of cache-invalidation events without that system knowing the cache exists. The trigger:

1. Subscribes to a queue or topic you do not own.
2. Validates each message with a Zod schema.
3. Runs your **resolver** to extract entity ids (and optionally a group).
4. Forwards the resulting actions through a configured `NotificationPublisher`, fanning them out to every cache instance.

The actions and resolver shape are transport-agnostic — the same `InvalidationResolver`, `InvalidationAction`, dispatch helpers, and `InvalidationTrigger` interface can power future RabbitMQ / Kafka / Pub/Sub adapters. The SNS/SQS adapters live in this package.

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

For local development and tests, swap the AWS SDK endpoint for [fauxqs](https://github.com/kibertoad/fauxqs):

```ts
import { startFauxqs } from 'fauxqs'
import { SNSClient } from '@aws-sdk/client-sns'
import { SQSClient } from '@aws-sdk/client-sqs'
import { STSClient } from '@aws-sdk/client-sts'

const server = await startFauxqs({ port: 0, logger: false })
const credentials = { accessKeyId: 'test', secretAccessKey: 'test' }
const region = 'us-east-1'

const snsClient = new SQSClient({ endpoint: server.address, region, credentials })
// ...
await server.stop()
```

This package's own integration tests run entirely against fauxqs in-process — see `packages/sqs/test`.

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
