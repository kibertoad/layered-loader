# @layered-loader/sqs
 
SNS/SQS remote-invalidation adapter for [`layered-loader`](https://github.com/kibertoad/layered-loader).

This package provides:

- **Notification publishers and consumers** that fan cache invalidations out across a cluster via an SNS topic and per-instance SQS queues — a drop-in alternative to the built-in Redis adapter for AWS-native deployments.
- **Flexible invalidation triggers** that subscribe to an *existing* upstream SNS topic or SQS queue (one that knows nothing about the caching layer) and translate domain events such as `user.updated` into cache invalidations applied to your `Loader` / `GroupLoader`.

The implementation is built on top of [`@message-queue-toolkit/sns`](https://github.com/kibertoad/message-queue-toolkit) and is tested against [fauxqs](https://github.com/kibertoad/fauxqs), an in-process SNS/SQS emulator.

> **Prefer Redis pub/sub when you can.** This package exists to support AWS-native deployments and upstream-event consumption, but operationally Redis pub/sub is simpler — no per-instance queues, no lifecycle management, no AWS quotas to track. If your only reason to be here is "I have an upstream SNS topic to consume", the **[recommended hybrid pattern](#recommended-pattern-redis-fanout--sqs-trigger)** is Redis publisher in the Loader + SQS trigger reading the upstream topic with a shared queue. You skip the queue-lifecycle problem entirely.

## Contents

- [Installation](#installation)
- [Picking your shape](#picking-your-shape)
- [Quick start: notification pair](#quick-start-notification-pair)
- [Group notification pair](#group-notification-pair)
- [Locator vs creation config](#locator-vs-creation-config)
- [How invalidation flows through SNS/SQS](#how-invalidation-flows-through-snssqs)
- [Self-message filtering and `serverUuid`](#self-message-filtering-and-serveruuid)
- [Flexible invalidation triggers](#flexible-invalidation-triggers)
  - [Recommended pattern: Redis fanout + SQS trigger](#recommended-pattern-redis-fanout--sqs-trigger)
  - [Triggering from an existing SNS topic](#triggering-from-an-existing-sns-topic)
  - [Triggering from an existing SQS queue](#triggering-from-an-existing-sqs-queue)
  - [Group triggers](#group-triggers)
  - [Multiple sources and event types](#multiple-sources-and-event-types)
  - [Mixing source kinds with `composeTriggers`](#mixing-source-kinds-with-composetriggers)
  - [Resolver semantics](#resolver-semantics)
  - [Error handling and retries](#error-handling-and-retries)
  - [Dead-letter queues](#dead-letter-queues)
  - [Explicit vs spread configuration](#explicit-vs-spread-configuration)
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

Node 22+ is required.

## Picking your shape

There are three deployment shapes you can build with this package, and they have very different operational profiles. Pick deliberately:

| Shape | Publisher | Trigger source | Queue churn | When to use |
| --- | --- | --- | --- | --- |
| **A. Pure Redis** (use [`layered-loader`](https://github.com/kibertoad/layered-loader#update-notifications) directly, not this package) | Redis pub/sub | (none, or Redis-driven) | None | Default. Use this whenever Redis is available and you have no upstream AWS events to consume. |
| **B. Pure SNS/SQS** | `SqsNotificationPublisher` | per-instance SQS queues | **Yes** — needs careful queue naming or external cleanup | Only when Redis is not available at all. |
| **C. Hybrid: Redis fanout + SQS trigger** ⭐ | Redis pub/sub | `SnsTopicInvalidationTrigger` on a **shared** queue, applying to a `Loader` whose publisher is Redis | None | When you have AWS upstream events to consume but Redis is available for cluster fanout. **Recommended for the upstream-events use case.** |

Shape **C** is almost always the right answer if you have AWS upstream events and Redis. It gives you AWS-native event ingestion *and* the operational simplicity of Redis fanout. See [Recommended pattern: Redis fanout + SQS trigger](#recommended-pattern-redis-fanout--sqs-trigger).

If you settle on shape **B** (no Redis at all), use stable queue names (StatefulSet ordinals, ECS fixed slot IDs) wherever your deployment topology allows — every restart with a random `HOSTNAME` leaks an SQS queue + SNS subscription, and SQS does not have AMQP-style auto-delete queues.

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

1. Subscribes to one or more queues or topics you do not own.
2. Validates each message with a Zod schema.
3. Runs your **resolver** to extract entity ids (and optionally a group).
4. Applies the resulting actions directly to your `Loader` / `GroupLoader` — which handles local in-memory and async-cache invalidation and, if you configured a notification pair, also fans the invalidation out to peer instances.

The actions and resolver shape are transport-agnostic — the same `InvalidationResolver`, `InvalidationAction`, and `InvalidationTrigger` interface can power future RabbitMQ / Kafka / Pub/Sub adapters. The SNS/SQS adapters live in this package.

### Recommended pattern: Redis fanout + SQS trigger

This is shape **C** from [Picking your shape](#picking-your-shape) and the recommended setup whenever you have both AWS upstream events to consume and Redis available. The `Loader` uses Redis for cluster fanout, and the trigger queue can be **shared across every instance** (no per-instance queues to manage):

```ts
import { z } from 'zod'
import Redis from 'ioredis'
import { createNotificationPair, Loader } from 'layered-loader'
import { SnsTopicInvalidationTrigger } from '@layered-loader/sqs'

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

// 2. The trigger applies invalidations directly to the loader. Each instance
//    runs this code, but the SQS queue is SHARED (no ${HOSTNAME} suffix) —
//    competing-consumer semantics deliver each upstream event to exactly one
//    instance. That instance's loader propagates via Redis pub/sub.
const trigger = new SnsTopicInvalidationTrigger({
  target: userLoader,
  dependencies: consumerDeps,
  sources: [
    {
      creationConfig: {
        topic: { Name: 'domain-events.users' },                  // upstream service's topic
        queue: { QueueName: 'user-cache-invalidation-trigger' }, // SHARED across all instances
      },
      bindings: [
        {
          messageSchema: USER_EVENT_SCHEMA,
          resolver: (msg) => ({ kind: 'delete', key: msg.userId }),
        },
      ],
    },
  ],
})

await trigger.start()
```

Operational properties:

- **One** SQS queue regardless of pod count → no churn, no lifecycle plumbing needed.
- AWS-native ingestion of upstream domain events.
- Redis pub/sub for cluster fanout — sub-ms latency, no per-instance setup.
- Natural failure isolation: if a pod crashes mid-message, SQS visibility timeout returns the message to the queue and another pod picks it up.

If your upstream events have meaningful per-entity ordering, use an SQS FIFO queue (`QueueName: 'user-cache-invalidation-trigger.fifo'` plus `FifoQueue: 'true'` in the queue attributes). Otherwise a standard queue is appropriate.

The remainder of this section describes the trigger classes themselves — they are used identically whether the loader's publisher is Redis (shape **C**, recommended) or `SqsNotificationPublisher` (shape **B**).

Four trigger classes ship for SNS/SQS:

| Class | Source kind | Target |
| --- | --- | --- |
| `SnsTopicInvalidationTrigger`         | SNS topic (subscribes a dedicated SQS queue) | flat `Loader` |
| `SqsQueueInvalidationTrigger`         | Existing SQS queue                           | flat `Loader` |
| `SnsTopicGroupInvalidationTrigger`    | SNS topic                                    | `GroupLoader` |
| `SqsQueueGroupInvalidationTrigger`    | Existing SQS queue                           | `GroupLoader` |

Each trigger is homogeneous in source kind and takes a single `dependencies` block (shared across every source it consumes). For deployments that need to mix source kinds, `composeTriggers(...)` bundles multiple triggers under one `start()` / `stop()`.

### Triggering from an existing SNS topic

The trigger creates (or reuses) an SQS queue and subscribes it to each upstream topic.

```ts
import { z } from 'zod'
import { Loader } from 'layered-loader'
import { createNotificationPair, SnsTopicInvalidationTrigger } from '@layered-loader/sqs'

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

const userLoader = new Loader<User>({
  inMemoryCache: { ttlInMsecs: 1000 * 60 * 5 },
  asyncCache: yourAsyncCache,
  notificationConsumer: cachePair.consumer,
  notificationPublisher: cachePair.publisher,
})

// 2. The trigger consumes domain events and applies them to the Loader.
//    The Loader's own publisher takes care of fanning out to peers.
const trigger = new SnsTopicInvalidationTrigger({
  target: userLoader,
  dependencies: consumerDeps,
  sources: [
    {
      creationConfig: {
        topic: { Name: 'domain-events.users' }, // owned by an upstream service
        queue: { QueueName: `cache-trigger-${process.env.HOSTNAME}` },
      },
      bindings: [
        {
          messageSchema: USER_EVENT_SCHEMA,
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
        },
      ],
    },
  ],
})

await trigger.start()
```

### Triggering from an existing SQS queue

If the upstream system writes directly to an SQS queue (no SNS topic in the middle), use `SqsQueueInvalidationTrigger`:

```ts
import { SqsQueueInvalidationTrigger } from '@layered-loader/sqs'

const trigger = new SqsQueueInvalidationTrigger({
  target: userLoader,
  dependencies: sqsConsumerDeps, // only needs SQS clients, not SNS/STS
  sources: [
    {
      locatorConfig: {
        queueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/domain-events',
      },
      bindings: [
        { messageSchema: DOMAIN_EVENT_SCHEMA, resolver: (msg) => /* ... */ },
      ],
    },
  ],
})

await trigger.start()
```

`SqsQueueInvalidationTrigger` uses `@message-queue-toolkit/sqs`'s consumer directly and does not require SNS / STS clients in its dependencies.

### Group triggers

The group counterparts emit `GroupInvalidationAction`s and target a `GroupLoader`:

```ts
import { SnsTopicGroupInvalidationTrigger } from '@layered-loader/sqs'

const trigger = new SnsTopicGroupInvalidationTrigger({
  target: tenantLoader, // a GroupLoader with its own notification pair
  dependencies: consumerDeps,
  sources: [
    {
      creationConfig: {
        topic: { Name: 'tenant-events' },
        queue: { QueueName: `tenant-trigger-${process.env.HOSTNAME}` },
      },
      bindings: [
        {
          messageSchema: TENANT_EVENT_SCHEMA,
          resolver: (msg) => {
            if (msg.type === 'tenant.purged') return { kind: 'deleteGroup', group: msg.tenantId }
            if (msg.type === 'tenant.user.updated' && msg.userId) {
              return { kind: 'deleteFromGroup', key: msg.userId, group: msg.tenantId }
            }
            return null
          },
        },
      ],
    },
  ],
})
```

`SqsQueueGroupInvalidationTrigger` is the SQS-queue counterpart.

### Multiple sources and event types

A trigger can subscribe to **multiple sources** at once (each spun up as an independent consumer) and can route **multiple event types from the same source** to different resolvers via a `messageTypeField` discriminator.

```ts
const USER_UPDATED = z.object({ type: z.literal('user.updated'), userId: z.string() })
const USER_BULK    = z.object({ type: z.literal('user.bulk'),    userIds: z.array(z.string()) })

const trigger = new SqsQueueInvalidationTrigger({
  target: userLoader,
  dependencies: sqsConsumerDeps,
  sources: [
    {
      locatorConfig: { queueUrl: process.env.UPSTREAM_QUEUE_A_URL! },
      bindings: [
        { messageSchema: USER_UPDATED, resolver: (m) => ({ kind: 'delete', key: m.userId }) },
      ],
    },
    // Same trigger, different queue, multiple event types
    {
      locatorConfig: { queueUrl: process.env.UPSTREAM_QUEUE_B_URL! },
      messageTypeField: 'type', // path on the message body that selects a binding
      bindings: [
        {
          messageType: 'user.updated',
          messageSchema: USER_UPDATED,
          resolver: (m) => ({ kind: 'delete', key: m.userId }),
        },
        {
          messageType: 'user.bulk',
          messageSchema: USER_BULK,
          resolver: (m) => ({ kind: 'deleteMany', keys: m.userIds }),
        },
      ],
    },
  ],
})
```

Rules:

- Each source must declare at least one binding.
- If a source has only one binding, `messageType` and `messageTypeField` are optional — the binding handles every message.
- If a source has two or more bindings, the source must specify `messageTypeField` and every binding must specify `messageType`. `messageTypeField` is a dotted path (e.g. `'metadata.eventId'`).

#### One binding over a union of event types

When several event types should all flow through a **single** resolver, you do not need one binding per type. Bind a single `z.union(...)` (or `z.discriminatedUnion(...)`) schema instead and branch inside the resolver. This is the natural shape when you already have message-queue-toolkit message definitions and want to react to a couple of their `consumerSchema`s:

```ts
const PROJECT_LANGUAGE_EVENT_SCHEMA = z.union([
  ExpertProjectLanguageEvent['project_language.added'].consumerSchema,
  ExpertProjectLanguageEvent['project_language.removed'].consumerSchema,
])

const trigger = new SnsTopicInvalidationTrigger({
  target: projectLoader,
  dependencies: consumerDeps,
  sources: [
    {
      creationConfig: {
        topic: { Name: 'domain-events.project-languages' },
        queue: { QueueName: `project-language-trigger-${process.env.HOSTNAME}` },
      },
      // No messageTypeField: this is still a single binding.
      bindings: [
        {
          messageSchema: PROJECT_LANGUAGE_EVENT_SCHEMA,
          resolver: (msg) => ({ kind: 'delete', key: msg.projectId }),
        },
      ],
    },
  ],
})
```

How routing behaves with this shape:

- **Every member of the union is routed.** Because there is one binding, every message is validated against the union schema and, on success, handed to the resolver — regardless of which union member it matched.
- **Event types outside the union are dropped.** A message that matches *neither* union member fails schema validation and is rejected **before** the resolver runs (it goes back to the queue / DLQ as a validation error — see [Error handling and retries](#error-handling-and-retries)). It never reaches your resolver and never invalidates anything.
- **Do not set `messageTypeField` for the union shape.** `messageTypeField` switches the source into the multi-binding routing mode above, where the extracted type must match a binding's `messageType`. With a single union binding there is no per-member `messageType` to match, so setting it would cause every message to be treated as an unknown type and dropped. Leave it unset so all messages route to the one binding and the union schema does the filtering.

Reach for the multi-binding `messageTypeField` form when each event type needs a **different** resolver; reach for the single union binding when one resolver handles them all and you simply want everything outside the union ignored.

### Mixing source kinds with `composeTriggers`

A single trigger class is homogeneous (only SNS topics, or only SQS queues). When a deployment needs both, build one of each and wrap them:

```ts
import { composeTriggers, SnsTopicInvalidationTrigger, SqsQueueInvalidationTrigger } from '@layered-loader/sqs'

const snsTrigger = new SnsTopicInvalidationTrigger({ target: userLoader, dependencies: snsSqsDeps, sources: [...] })
const sqsTrigger = new SqsQueueInvalidationTrigger({ target: userLoader, dependencies: sqsDeps,    sources: [...] })

const triggers = composeTriggers(snsTrigger, sqsTrigger)
await triggers.start()
// later
await triggers.stop()
```

`composeTriggers` returns a plain `InvalidationTrigger` whose `start()` / `stop()` fan out to every wrapped trigger in parallel.

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
  | { kind: 'clear' }
```

Group actions:

```ts
type GroupInvalidationAction =
  | { kind: 'deleteFromGroup'; key: string; group: string }
  | { kind: 'deleteGroup'; group: string }
  | { kind: 'clear' }
```

Resolvers may be `async`; the trigger awaits before applying actions.

### Error handling and retries

If the resolver or apply step throws, the trigger:

1. Invokes the optional `errorHandler(err, channel)` for observability.
2. Re-throws so `message-queue-toolkit` can apply its standard SQS retry / dead-letter behaviour.

For schema-violation errors, the message is failed by `message-queue-toolkit` before the resolver runs and goes back to the queue (and ultimately to a DLQ if you configured one).

### Dead-letter queues

To bound retries, add a `deadLetterQueue` to any trigger source. With a `creationConfig` the trigger **auto-creates the DLQ, attaches the redrive policy to its own queue, and (for SNS sources) wires the subscription** — no manual AWS setup required:

```ts
const trigger = new SnsTopicInvalidationTrigger({
  target: userLoader,
  dependencies: consumerDeps,
  sources: [
    {
      creationConfig: {
        topic: { Name: 'domain-events.users' },
        queue: { QueueName: `cache-trigger-${process.env.HOSTNAME}` },
      },
      deadLetterQueue: {
        // Move a message to the DLQ after this many failed receives.
        redrivePolicy: { maxReceiveCount: 3 },
        // Auto-create the DLQ. Use `locatorConfig` instead to point at an existing one.
        creationConfig: { queue: { QueueName: `cache-trigger-${process.env.HOSTNAME}-dlq` } },
      },
      bindings: [/* ... */],
    },
  ],
})
```

The `deadLetterQueue` field is the same shape `message-queue-toolkit` exposes on its consumers. It is available on all four trigger source types.

### Explicit vs spread configuration

A trigger source **is** the underlying `message-queue-toolkit` consumer options (minus the `handlers` list, which the trigger builds from `bindings`). That means both styles are fully type-checked — autocomplete and typo detection on every option:

- **Explicit** — spell options out inline (`creationConfig`/`locatorConfig`, `deadLetterQueue`, `subscriptionConfig`, `concurrentConsumersAmount`, `consumerOverrides`, ...). An unknown key or a wrong-typed value is a compile error.
- **Spread** — resolve options elsewhere — e.g. with `@lokalise/aws-config`'s `getSnsMqtOptionsResolver()` — and spread the result straight in.

The trigger always overrides `handlers` with the ones it builds from `bindings`; everything else flows through untouched.

```ts
const resolver = getSnsMqtOptionsResolver({ appEnv: 'production' })
const options = resolver.resolveConsumerOptions(topicName, queueName, {
  /* awsConfig, logger, deadLetterQueue, ... */
})

const trigger = new SnsTopicInvalidationTrigger({
  target,
  dependencies,
  sources: [
    {
      ...options,
      bindings: [
        { messageSchema: PROJECT_LANGUAGE_EVENT_SCHEMA, resolver: async (message) => { /* ... */ } },
      ],
    },
  ],
})
```

### Lifecycle

```ts
const trigger = new SnsTopicInvalidationTrigger({ ... }) // or SqsQueueInvalidationTrigger, plus the group variants

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
| `SqsNotificationPublisher<T>` | Lower-level constructor for direct notification publishing when not using `createNotificationPair`. |
| `SqsNotificationConsumer<T>` | Lower-level constructor; rarely used directly. |
| `SqsGroupNotificationPublisher<T>` / `SqsGroupNotificationConsumer<T>` | Group-cache equivalents. |
| `SqsSubscriptionOptions` | Type for `subscriptionConfig` overrides. |

### Triggers

| Symbol | Purpose |
| --- | --- |
| `SnsTopicInvalidationTrigger` | Flat-cache trigger consuming from upstream SNS topics. |
| `SqsQueueInvalidationTrigger` | Flat-cache trigger consuming directly from upstream SQS queues. |
| `SnsTopicGroupInvalidationTrigger` / `SqsQueueGroupInvalidationTrigger` | `GroupLoader` counterparts. |
| `composeTriggers(...triggers)` | Wraps multiple `InvalidationTrigger`s into one combined `start()` / `stop()`. |
| `SnsTopicInvalidationSource` / `SqsQueueInvalidationSource` | A single upstream source: every `message-queue-toolkit` consumer option (`creationConfig`/`locatorConfig`, `deadLetterQueue`, `subscriptionConfig`, ...) minus `handlers`, plus `bindings` and optional `messageTypeField`. Fully typed for both explicit and spread configuration. Group counterparts have parallel names. |
| `FlatBinding<TMessage>` / `GroupBinding<TMessage>` | One `(messageSchema, resolver, messageType?)` triple. |
| `InvalidationTarget` / `GroupInvalidationTarget` | Structural interfaces that `Loader` / `GroupLoader` satisfy. |
| `InvalidationAction` / `GroupInvalidationAction` | Action ADTs returned by resolvers. |
| `InvalidationResolver<TMessage, TAction>` | Resolver signature. |
| `InvalidationTrigger` | `start()` / `stop()` lifecycle interface. |
| `runFlatPipeline` / `runGroupPipeline` | Reusable resolver + dispatch helpers (transport-agnostic). |
| `applyFlatAction` / `applyGroupAction` | Apply a single resolved action to a target. |
| `buildFlatBindings` / `buildGroupBindings` | Helpers that turn a binding array into `MessageHandlerConfig`s — useful when writing a custom trigger. |
| `AbstractSqsTrigger` | Lifecycle-only base class for building custom SQS-based triggers. |
| `SqsQueueTriggerConsumer` / `SnsTopicTriggerConsumer` | Concrete subclasses of `@message-queue-toolkit` consumers, exposed for advanced custom triggers. |
| `deriveSqsQueueChannelName` / `deriveSnsTopicChannelName` (+ group variants) | Derive a logical channel name from a source config. |
