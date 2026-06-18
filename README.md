<div align="center">
    <img
      src="https://raw.githubusercontent.com/kibertoad/layered-loader/main/graphics/raw/layered-loader_full-color_transparent.svg"
      width="260"
      height="auto"
    />
  </a>
</div>

[![npm version](http://img.shields.io/npm/v/layered-loader.svg)](https://npmjs.org/package/layered-loader)
[![](https://img.shields.io/npm/dm/layered-loader.svg)](https://npmjs.org/package/layered-loader)
![](https://github.com/kibertoad/layered-loader/workflows/ci/badge.svg)
[![Coverage Status](https://coveralls.io/repos/kibertoad/layered-loader/badge.svg?branch=main)](https://coveralls.io/r/kibertoad/layered-loader?branch=main)
 
Data source agnostic data loader with support for tiered in-memory and async caching, fetch deduplication and fallback data sources. Implements Cache-Aside, Read-Through and Refresh-Ahead patterns.

Special thanks to Diana Baužytė for creating the project logo.

You can watch [NodeConf EU 2023 talk](https://www.youtube.com/watch?v=O0Nk3XhxxYg) for a brief and visual overview of what new features `layered-loader` brings to the table of the Node.js caching.

## Contents

- [Prerequisites](#prerequisites)
- [Use-cases](#use-cases)
- [Feature Comparison](#feature-comparison)
- [Performance Comparison](#performance-comparison)
  - [In-Memory Store](#in-memory-store)
  - [Redis Store](#redis-store)
- [Basic concepts](#basic-concepts)
- [Basic example](#basic-example)
  - [Simplified loader syntax](#simplified-loader-syntax)
- [Loader API](#loader-api)
- [Parametrized loading](#parametrized-loading)
- [Update notifications](#update-notifications)
  - [Available notification adapters](#available-notification-adapters)
  - [Picking a notification adapter](#picking-a-notification-adapter)
  - [Redis pub/sub](#redis-pubsub)
  - [AWS SNS/SQS](#aws-snssqs)
    - [How fanout works](#how-fanout-works)
- [Flexible invalidation triggers](#flexible-invalidation-triggers)
  - [Recommended pattern: Redis fanout + SQS trigger](#recommended-pattern-redis-fanout--sqs-trigger)
  - [SNS/SQS adapter](#snssqs-adapter)
- [Cache statistics](#cache-statistics)
- [Cache-only operations](#cache-only-operations)
  - [Forcing an update](#forcing-an-update)
  - [Forcing a specific value](#forcing-a-specific-value)
- [Usage in high-performance systems](#usage-in-high-performance-systems)
  - [Synchronous short-circuit](#synchronous-short-circuit)
  - [Preemptive background refresh](#preemptive-background-refresh)
- [Group operations](#group-operations)
- [Provided async caches](#provided-async-caches)
  - [RedisCache](#rediscache)
- [Redis connection safety](#redis-connection-safety)
  - [Automatic READONLY reconnection](#automatic-readonly-reconnection)
  - [Using `enrichRedisConfig` for your own connections](#using-enrichredisconfig-for-your-own-connections)
  - [Cloud-optimized configuration](#cloud-optimized-configuration)

## Prerequisites

Node: 16+

## Use-cases

This library has four main goals:

1. Provide transparent, high performance, flexible caching mechanism for data retrieval operations;
2. Prevent redundant data retrieval in high-load systems;
3. Support distributed in-memory cache invalidation to prevent stale data in cache;
4. Enable fallback mechanism for retrieving data when alternate sources exist;

## Feature Comparison

Since there are a few cache solutions, here is a table comparing them:

| Feature                                          | [layered-loader](https://github.com/kibertoad/layered-loader) | [async-cache-dedupe](https://github.com/mcollina/async-cache-dedupe) | [dataloader](https://github.com/graphql/dataloader) | [cache-manager](https://github.com/node-cache-manager/node-cache-manager) |
| :----------------------------------------------- | :-----------------------------------------------------------: | :------------------------------------------------------------------: | :-------------------------------------------------: | :-----------------------------------------------------------------------: |
| Single Entity Fetch                              |                               ✓                               |                                  ✓                                   |                          ✓                          |                                     ✓                                     |
| Bulk Entity Fetch                                |                               ✓                               |                                                                      |                          ✓                          |                                     ✓                                     |
| Single Entity Fetch Deduplication (Read-Through) |                               ✓                               |                                  ✓                                   |                          ✓                          |                                                                           |
| Bulk Entity Fetch Deduplication                  |                               ✓                               |                                                                      |                          ✓                          |                                                                           |
| Preemptive Cache Refresh (Refresh-Ahead)         |                               ✓                               |                                                                      |                                                     |                                                                           |
| Tiered Caches                                    |                               ✓                               |                                                                      |                                                     |                                     ✓                                     |
| Group Support                                    |                               ✓                               |                partially, references for invalidation                |                                                     |                                                                           |
| Redis Support                                    |                               ✓                               |                                  ✓                                   |                                                     |                                     ✓                                     |
| Redis Key Auto-Prefixing                         |                               ✓                               |                                                                      |                                                     |                                                                           |
| Synchronous In-Memory Cache Access               |                               ✓                               |                                                                      |                                                     |                                                                           |
| Distributed In-Memory Cache Invalidation         |                               ✓                               |                                                                      |                                                     |                                                                           |
| Hit/Miss/Expiration Tracking                     |                               ✓                               |                      partially, hooks available                      |                                                     |                                                                           |
| Support For Custom Cache Stores                  |                               ✓                               |                                                                      |                                                     |                                     ✓                                     |
| Optimized for                                    |                        Broad‑Scope Use                        |                  Single Entity Fetch Deduplication                   |           Bulk Entity Fetch Deduplication           |                              Manual Caching                               |

## Performance Comparison

You can find all the benchmarks used for the comparison in [NodeJS benchmark repo](https://github.com/kibertoad/nodejs-benchmark-tournament). Please let us know if they can be made more accurate!

### In-Memory Store

Higher is better:

| Feature - Ops/sec              | [layered-loader](https://github.com/kibertoad/layered-loader) | [async-cache-dedupe](https://github.com/mcollina/async-cache-dedupe) | [dataloader](https://github.com/graphql/dataloader) | [cache-manager](https://github.com/node-cache-manager/node-cache-manager) | [toad-cache](https://github.com/kibertoad/toad-cache) | [tiny-lru](https://github.com/avoidwork/tiny-lru) |
| :----------------------------- | :-----------------------------------------------------------: | :------------------------------------------------------------------: | :-------------------------------------------------: | :-----------------------------------------------------------------------: | :---------------------------------------------------: | :-----------------------------------------------: |
| Single Entity Fetch            |                           3836.436                            |                               446.146                                |                       717.420                       |                                   ToDo                                    |                       4191.279                        |                     3818.146                      |
| Bulk Entity Fetch              |                                                               |                                                                      |                                                     |                                                                           |                                                       |                                                   |
| Concurrent Single Entity Fetch |                                                               |                                                                      |                                                     |                                                                           |                                                       |                                                   |
| Concurrent Bulk Entity Fetch   |                                                               |                                                                      |                                                     |                                                                           |                                                       |                                                   |

### Redis Store

Higher is better:

| Feature - Ops/sec              | [layered-loader](https://github.com/kibertoad/layered-loader) | [async-cache-dedupe](https://github.com/mcollina/async-cache-dedupe) | [cache-manager](https://github.com/node-cache-manager/node-cache-manager) | [ioredis](https://github.com/redis/ioredis) |
| :----------------------------- | :-----------------------------------------------------------: | :------------------------------------------------------------------: | :-----------------------------------------------------------------------: | :-----------------------------------------: |
| Single Entity Fetch            |                                                               |                                                                      |                                                                           |                                             |
| Bulk Entity Fetch              |                                                               |                                                                      |                                                                           |                                             |
| Concurrent Single Entity Fetch |                            167.745                            |                               124.854                                |                                  40.234                                   |                   47.775                    |
| Concurrent Bulk Entity Fetch   |                                                               |                                                                      |                                                                           |                                             |

## Basic concepts

###

There are two main entity types defined by `layered-loader`:

1. **Loader** - defined procedure of retrieving data from one or more data sources with full deduplication (same resource is only asked once at any given time), with an optional caches in the middle. Loader is composed of Data Sources and Caches.
2. **Manual cache** - async cache and/or sync in-memory cache, with deduplication for retrieval commands, which is populated explicitly.

Loaders and caches are composed out of the following building blocks.

1. **InMemoryCache** - synchronous in-memory cache. Offers highest possible performance. If used with a longer TTL, you should consider using a notification Publisher/Consumer pair for distributed cache invalidation, to prevent your cached data from becoming stale;
2. **AsyncCache** - asynchronous remote cache. Slower than in-memory cache, but can be invalidated more easily, as it is shared across all nodes of a distributed system.
3. **Data Source** - primary source of truth of data, that can be used for populating caches. Used in a strictly read-only mode.

- `layered-loader` will try loading the data from the data source defined for the Loader, in the following order: InMemory, AsyncCache, DataSources. In case `undefined` value is the result of retrieval, next source in sequence will be used, until there is either a value, or there are no more sources available;
- `null` and `undefined` have different semantics:
  - `null` means "value was successfully resolved, but it is empty" - this **will be cached** and subsequent data sources will not be queried;
  - `undefined` means "value was not resolved" - this **will NOT be cached** and the next data source in the sequence will be queried. If all data sources return `undefined`, the Loader returns `undefined` without caching anything;
- If non-last data source throws an error, it is handled using configured ErrorHandler. If the last data source throws an error, and there are no remaining fallback data sources, an error will be thrown by the Loader.
- If any caches (InMemoryCache or AsyncCache) precede the source, that returned a value, all of them will be updated with that value;
- If there is an ongoing retrieval operation for the given key, promise for that retrieval will be reused and returned as a result of `loader.get`, instead of starting a new retrieval.
- You can use just the memory cache, just the asynchronous one, neither, or both. Unconfigured layer will be simply skipped for all operations (both storage and retrieval).

## Basic example

Let's define a data source, which will be the primary source of truth, and two levels of caching:

```ts
import Redis from 'ioredis'
import { RedisCache, InMemoryCache } from 'layered-loader'
import type { DataSource } from 'layered-loader'

const ioRedis = new Redis({
  host: 'localhost',
  port: 6379,
  password: 'sOmE_sEcUrE_pAsS',
})

class ClassifiersDataSource implements DataSource<Record<string, any>> {
  private readonly db: Knex
  name = 'Classifiers DB loader'
  isCache = false

  constructor(db: Knex) {
    this.db = db
  }

  async get(key: string): Promise<Record<string, any> | undefined | null> {
    const results = await this.db('classifiers')
      .select('*')
      .where({
        id: parseInt(key),
      })
    return results[0]
  }

  async getMany(keys: string[]): Promise<Record<string, any>[]> {
    return this.db('classifiers').select('*').whereIn('id', keys.map(parseInt))
  }
}

const loader = new Loader<string>({
  // this cache will be checked first
  inMemoryCache: {
    cacheType: 'lru-map', // you can choose between lru and fifo caches, fifo being 10% slightly faster
                          // 'lru-object' is another option, it is slightly faster for non-string keys
    ttlInMsecs: 1000 * 60,
    maxItems: 100,
  },

  // this cache will be checked if in-memory one returns undefined
  asyncCache: new RedisCache<string>(ioRedis, {
    json: true, // this instructs loader to serialize passed objects as string and deserialize them back to objects
    ttlInMsecs: 1000 * 60 * 10,
  }),

  // this will be used if neither cache has the requested data
  dataSources: [new ClassifiersDataSource(db)],
})

// If cache is empty, but there is data in the DB, after this operation is completed, both caches will be populated
const classifier = await loader.get('1')
```

### Simplified loader syntax

It is also possible to inline datasource definition:

```ts
const loader = new Loader<string>({
  // this cache will be checked first
  inMemoryCache: {
    cacheType: 'lru-map', // you can choose between lru and fifo caches, fifo being 10% slightly faster
                          // 'lru-object' is another option, it is slightly faster for non-string keys
    ttlInMsecs: 1000 * 60,
    maxItems: 100,
  },

  // this cache will be checked if in-memory one returns undefined
  asyncCache: new RedisCache<string>(ioRedis, {
    json: true, // this instructs loader to serialize passed objects as string and deserialize them back to objects
    ttlInMsecs: 1000 * 60 * 10,
  }),

  // data source will be generated from one or both provided data loading functions
  dataSourceGetOneFn: async (key: string) => {
    const results = await this.db('classifiers')
      .select('*')
      .where({
        id: parseInt(key),
      })
    return results[0]
  },
  dataSourceGetManyFn: (keys: string[]) => {
    return this.db('classifiers').select('*').whereIn('id', keys.map(parseInt))
  },
})

// If cache is empty, but there is data in the DB, after this operation is completed, both caches will be populated
const classifier = await loader.get('1')
```

## Loader API

Loader has the following config parameters:

- `throwIfUnresolved: boolean` - if true, error will be thrown if all data sources return `undefined`;
- `throwIfLoadError: boolean` - if true, error will be thrown if any Loader throws an error;
- `cacheUpdateErrorHandler: LoaderErrorHandler` - error handler to use when cache throws an error during update;
- `loadErrorHandler: LoaderErrorHandler` - error handler to use when non-last data source throws an error during data retrieval.
- `cacheKeyFromLoadParamsResolver: CacheKeyResolver<LoadParams>` - mapper from LoadParams to a cache key. Defaults to a simple string passthrough when LoadParams are just a string key to begin with (which is the default)
- `cacheKeyFromValueResolver: CacheKeyResolver<LoadParams>` - mapper from entity to be cached to a cache key. Defaults to a dummy resolver which throws an error when methods that depend on it are used. Make sure to provide a real resolver if you are using the bulk API (getMany/getManyFromGroup)

Loader provides following methods:

- `invalidateCacheFor(key: string): Promise<void>` - expunge all entries for given key from all caches of this Loader;
- `invalidateCacheForMany(keys: string[]): Promise<void>` - expunge all entries for given keys from all caches of this Loader;
- `invalidateCache(): Promise<void>` - expunge all entries from all caches of this Loader;
- `get(loadParams: LoadParams = string): Promise<T>` - sequentially attempt to retrieve data for specified key from all caches and loaders, in an order in which those data sources passed to the Loader constructor.
- `getMany(keys: string[], loadManyParams?: LoadManyParams = LoadParams): Promise<T>` - sequentially attempt to retrieve data for specified keys from all caches and data sources, in an order in which those data sources were passed to the Loader constructor. Duplicate keys in the input array are automatically deduplicated to optimize performance and prevent redundant data source calls. Note that this retrieval mode doesn't support preemptive background refresh. Note that you need to manually resolve all keys upfront for this retrieval method (e. g. by using cacheKeyFromLoadParamsResolver from the Loader).

## Parametrized loading

Sometimes you need to pass additional parameters for loader in case it will need to refill the cache, such as JWT token (for external calls) or additional query parameters (for a DB call).
You can use optional generic `LoadParams` for that:

```ts
import type { DataSource } from 'layered-loader'

export type MyLoaderParams = {
  jwtToken: string
  entityId: string
}

export type MyLoaderManyParams = {
  jwtToken: string
}

class MyParametrizedDataSource implements DataSource<string, MyLoaderParams, MyLoaderManyParams> {
  async get(params: MyLoaderParams): Promise<string | undefined | null> {
    const resolvedValue = await someResolutionLogic(params.entityId, params.jwtToken)
    return resolvedValue
  }

  async getMany(entityIds: string[], params?: MyLoaderManyParams): Promise<string>[] {
    if (!params) {
        throw new Error('Load params are mandatory for MyParametrizedDataSource')
    } 
      
    const resolvedValues = await someBulkResolutionLogic(entityIds, params.jwtToken)
    return resolvedValues
  }
}

const loader = new Loader<string, MyLoaderParams>({
  inMemoryCache: IN_MEMORY_CACHE_CONFIG,
  dataSources: [new MyParametrizedDataSource()],
  cacheKeyFromLoadParamsResolver: (params) => params.entityId // if unique id consists of more than one field, you can concatenate them here
})
await operation.get({ jwtToken: 'someTokenValue', entityId: 'key' })
```

## Update notifications

It is possible to mostly rely on fast in-memory caches and still keep data in sync across multiple nodes in a distributed system. In order to achieve this, you need to use Notification Publisher/Consumer pair.
The way it works - whenever there is an invalidation event within the loader (`invalidate`, `invalidateFor` or `invalidatForGroup` methods are invoked), publisher sends a fanout notification to all subscribed consumers, and they invalidate their own caches as well.

### Available notification adapters

| Transport | Package | One-liner |
| --- | --- | --- |
| **Redis pub/sub** (default) | Built-in (`createNotificationPair` from `layered-loader`) | Lowest latency, no per-instance queue setup, no lifecycle management. |
| AWS SNS + SQS | [`@layered-loader/sqs`](packages/sqs/README.md) | AWS-native fanout via one SNS topic and per-instance SQS queues. |

Both adapters implement the same `notificationPublisher` / `notificationConsumer` contract — the rest of your Loader configuration does not change when you swap one for the other.

### Picking a notification adapter

**Prefer Redis pub/sub.** It is the simplest path operationally — no per-instance resources to provision or reap, no AWS quotas to worry about, no extra latency. Use Redis pub/sub whenever your stack already runs Redis (which it almost always does if you are using `RedisCache`).

The SNS/SQS adapter exists for two situations:

1. **You cannot run Redis** (e.g. a hard "AWS-managed services only" policy). Use the SNS/SQS adapter end-to-end. This works, but the per-instance SQS queue model has real operational costs — every restart with a fresh `HOSTNAME` leaks an SQS queue + SNS subscription unless you also use stable queue names.
2. **You need to consume upstream AWS events** (an SNS topic owned by another service) and turn them into cache invalidations. In this case the **recommended pattern is a hybrid**: Redis pub/sub for the cache cluster's own fanout, plus an SQS trigger reading the upstream topic. The trigger applies invalidations directly to your `Loader`, and the loader's Redis publisher handles fan-out. See [Flexible invalidation triggers](#flexible-invalidation-triggers).

### Redis pub/sub

Here is an example:

```ts
import Redis from 'ioredis'
import type { RedisOptions } from 'ioredis'
import { createNotificationPair, Loader } from 'layered-loader'

const redisOptions: RedisOptions = {
  host: 'localhost',
  port: 6379,
  password: 'sOmE_sEcUrE_pAsS',
}

export type User = {
  // some type
}

const redisPublisher = new Redis(redisOptions)
const redisConsumer = new Redis(redisOptions)
const redisCache = new Redis(redisOptions)

const { publisher: notificationPublisher, consumer: notificationConsumer } = createNotificationPair<User>({
  channel: 'user-cache-notifications',
  consumerRedis: redisConsumer, // you can pass redis config instead
  publisherRedis: redisPublisher, // you can pass redis config instead
})

const userLoader = new Loader({
  inMemoryCache: { ttlInMsecs: 1000 * 60 * 5 },
  asyncCache: new RedisCache<User>(redisCache, {
    ttlInMsecs: 1000 * 60 * 60,
  }),
  notificationConsumer,
  notificationPublisher,
})

await userLoader.init() // this will ensure that consumers have definitely finished registering on startup, but is not required

await userLoader.invalidateCacheFor('key') // this will transparently invalidate cache across all instances of your application
```

There is an equivalent for group loaders as well:

```ts
import Redis from 'ioredis'
import type { RedisOptions } from 'ioredis'
import { createGroupNotificationPair, GroupLoader } from 'layered-loader'

const redisOptions: RedisOptions = {
  host: 'localhost',
  port: 6379,
  password: 'sOmE_sEcUrE_pAsS',
}

export type User = {
  // some type
}

const redisPublisher = new Redis(redisOptions)
const redisConsumer = new Redis(redisOptions)
const redisCache = new Redis(redisOptions)

const { publisher: notificationPublisher, consumer: notificationConsumer } = createGroupNotificationPair<User>({
  channel: 'user-cache-notifications',
  consumerRedis: redisConsumer,
  publisherRedis: redisPublisher,
})

const userLoader = new GroupLoader({
  inMemoryCache: { ttlInMsecs: 1000 * 60 * 5 },
  asyncCache: new RedisCache<User>(redisCache, {
    ttlInMsecs: 1000 * 60 * 60,
  }),
  notificationConsumer,
  notificationPublisher,
})

await userLoader.init() // this will ensure that consumers have definitely finished registering on startup, but is not required

await userLoader.invalidateCacheFor('key', 'group') // this will transparently invalidate cache across all instances of your application
```

### AWS SNS/SQS

[`@layered-loader/sqs`](packages/sqs/README.md) provides a drop-in publisher/consumer pair backed by an SNS topic with one SQS queue **per instance**. The shape of the configuration mirrors the Redis pair — only the adapter changes.

#### How fanout works

SQS on its own is a competing-consumer queue: if every node read from the same queue, each invalidation would be delivered to only one of them and the rest would silently keep stale data. To get pub/sub-style fanout the adapter uses the SNS-fanout-to-SQS pattern:

1. There is **one shared SNS topic** (named in `creationConfig.topic.Name` — the same on every instance).
2. Each instance creates its **own SQS queue** subscribed to that topic. SNS delivers a copy of every published message to every subscribed queue.
3. Each instance consumes only its own queue, so it sees every invalidation exactly once.

This means **each instance must pass a unique `QueueName`** in its consumer's `creationConfig.queue`. The example below uses `process.env.HOSTNAME` for that — any per-instance identifier works (pod name, ECS task id, etc.). If two instances share a queue name they will share the queue and compete for messages, and roughly half the invalidations will be missed by each of them.

In `locatorConfig` mode the same rule applies, just shifted to provisioning: each instance must be pointed at its own pre-created `queueUrl` / `subscriptionArn`.

The publisher side is the opposite — all instances publish to the **same** topic ARN, so a single shared `topic.Name` in the publisher's `creationConfig` is correct (and required for the fanout to reach every subscriber).


```ts
import { Loader } from 'layered-loader'
import { createNotificationPair } from '@layered-loader/sqs'

const { publisher: notificationPublisher, consumer: notificationConsumer } =
  createNotificationPair<User>({
    publisher: {
      dependencies: pubDeps,
      creationConfig: { topic: { Name: 'user-cache-invalidations' } },
    },
    consumer: {
      dependencies: consumerDeps,
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

await userLoader.invalidateCacheFor('key')
```

`createGroupNotificationPair` from the same package is the `GroupLoader` equivalent. See the [package README](packages/sqs/README.md) for the full configuration reference (locator vs creation config, self-message filtering, AWS SDK dependencies, etc.).

## Flexible invalidation triggers

Cache invalidations often need to fire in response to *upstream* domain events — a `user.updated` message published by another service onto an SNS topic, SQS queue, RabbitMQ exchange, or Kafka topic — rather than from writes inside the application that owns the cache. Wiring those events in usually means writing bespoke glue per service.

Layered-loader ships transport-agnostic primitives for that translation step, complementary to the cluster fanout described [above](#update-notifications):

- `InvalidationAction` / `GroupInvalidationAction` — the invalidation operations a resolver may emit.
- `InvalidationResolver<TMessage, TAction>` — a pure function `(message) => action | action[] | null` that maps an upstream message to invalidations.
- `InvalidationTrigger` — `start()` / `stop()` lifecycle interface implemented by every adapter.

A trigger consumes from one or more upstream sources, runs your resolver, and applies the resulting actions directly to a target — typically your `Loader` or `GroupLoader`. The loader already knows how to invalidate its own in-memory and async caches and (if you configured a notification pair) how to fan the invalidation out to peer instances, so the trigger reuses that machinery rather than introducing a second publication path.

### Recommended pattern: Redis fanout + SQS trigger

If your upstream is AWS-native (an SNS topic owned by another service) but your own infrastructure runs Redis, this is the **recommended setup**. You get AWS-native event ingestion *without* the per-instance SQS queue lifecycle problem, because the trigger queue can be **shared across every instance**:

- The cache cluster's own notification pair is Redis pub/sub. Every Loader invalidation fans out via Redis — sub-ms latency, no per-instance queues, no cleanup.
- A single SQS queue is subscribed to the upstream SNS topic. Each instance runs the trigger code; SQS's competing-consumer semantics mean only **one** instance processes each upstream event.
- That instance's trigger calls `loader.invalidateCacheFor(...)`, the loader writes through to the local in-memory + async caches, and the loader's Redis publisher propagates to every other instance.

```ts
import { z } from 'zod'
import Redis from 'ioredis'
import { createNotificationPair, Loader } from 'layered-loader'
import { SnsTopicInvalidationTrigger } from '@layered-loader/sqs'

const USER_EVENT = z.object({ type: z.literal('user.updated'), userId: z.string() })
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

// 2. The trigger applies invalidations directly to the loader. The trigger
//    queue is SHARED across every instance (no ${HOSTNAME} suffix) — SQS
//    delivers each upstream event to exactly one of them.
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
        { messageSchema: USER_EVENT, resolver: (msg) => ({ kind: 'delete', key: msg.userId }) },
      ],
    },
  ],
})
await trigger.start()
```

Why this is the right default for AWS-upstream consumption:

- **No queue churn.** One SQS queue exists, regardless of how many pods run.
- **No lifecycle plumbing.** No `deleteQueueOnClose`, no heartbeat, no reaper.
- **Failure isolation.** If a pod dies mid-message, SQS visibility timeout returns it to the queue and another pod picks it up.
- **Cluster-wide fanout via Redis** — every instance's in-memory cache reacts within milliseconds.

If your upstream events have meaningful per-entity ordering, use an SQS FIFO queue (`QueueName: 'user-cache-invalidation-trigger.fifo'`). Otherwise a standard queue is appropriate.

### SNS/SQS adapter

The concrete adapter ships in [`@layered-loader/sqs`](packages/sqs/README.md) as four trigger classes:

| Class | Source kind | Target |
| --- | --- | --- |
| `SnsTopicInvalidationTrigger`         | Upstream SNS topic | flat `Loader` |
| `SqsQueueInvalidationTrigger`         | Existing SQS queue | flat `Loader` |
| `SnsTopicGroupInvalidationTrigger`    | Upstream SNS topic | `GroupLoader` |
| `SqsQueueGroupInvalidationTrigger`    | Existing SQS queue | `GroupLoader` |

Each trigger takes a single `dependencies` block and an array of `sources` (queues or topics) — listening to multiple at once is just listing them. Within one source, multiple event types can be routed to different resolvers via a `messageTypeField` discriminator. `composeTriggers(...)` bundles multiple triggers for deployments that need to mix source kinds.

Future adapters (RabbitMQ, Kafka, Google Pub/Sub, ...) reuse the same `InvalidationAction` / resolver primitives — only the consumer wiring changes. See the [package README](packages/sqs/README.md#flexible-invalidation-triggers) for the full reference, including group triggers, multi-source / multi-binding configuration, mixing source kinds via `composeTriggers`, and error handling.

## Cache statistics

You can keep track of your in-memory cache usage is by using special cache type - `lru-object-statistics`:

```ts
import { HitStatisticsRecord, Loader } from 'layered-loader'

const record = new HitStatisticsRecord()
const operation = new Loader({
  inMemoryCache: {
    ttlInMsecs: 99999,
    cacheId: 'some cache',
    globalStatisticsRecord: record,
    cacheType: 'lru-object-statistics',
  },
})

operation.getInMemoryOnly('value')

expect(record.records).toEqual({
  'some cache': {
    '2023-05-20': {
      cacheSize: 100, // how many elements does cache currently have
      evictions: 5, // how many elements were evicted due to cache being at max capacity
      expirations: 0, // how many elements were removed during get due to their ttl being exceeded
      hits: 0, // how many times element was successfully retrieved from cache during get
      emptyHits: 0, // out of all hits, how many were null, undefined or ''?
      falsyHits: 0, // out of all hits, how many were falsy?
      misses: 1, // how many times element was not in cache or expired during get
      invalidateOne: 1, // how many times element was invalidated individually
      invalidateAll: 2, // how many times entire cache was invalidated
      sets: 0, // how many times new element was added
    },
  },
})
```

Note that statistics accumulation affects performance of the cache, and it is recommended
to only enable it temporarily, while conducting cache effectiveness analysis.

## Cache-only operations

Sometimes you may want to avoid implementing loader in the chain (e. g. when retrieval is too complex to be fit into a single key paradigm),
while still having a sequence of caches. In that case you can define a caching operation:

```ts
const cache = new ManualCache<string>({
  // this cache will be checked first
  inMemoryCache: {
    ttlInMsecs: 1000 * 60,
    maxItems: 100,
  },

  // this cache will be checked if in-memory one returns undefined
  asyncCache: new RedisCache<string>(ioRedis, {
    json: true, // this instructs loader to serialize passed objects as string and deserialize them back to objects
    ttlInMsecs: 1000 * 60 * 10,
  }),
})

// this will populate all caches
await cache.set('1', 'someValue')

// If any of the caches are still populated at the moment of this operation, 'someValue' will propagate across all caches
const classifier = await cache.get('1')
```

Note that Loaders are generally recommended over ManualCaches, as they offer better performance: LoadingOperations deduplicate all the get requests that come during the window between checking the cache and populating it, while Caching Operation will resolve all of them to undefined after checking the cache, both increasing load on the cache, and also potentially invoking the loading logic multiple times.

### Forcing an update

In certain cases you may want to fetch fresh data from the datasource before invalidating the cache. In that case you should use the `forceRefresh` method:

```ts
// This will resolve the latest version of the data for the key "1", update async and inmemory caches and fire a NotificationPublisher invalidation command, if publisher is set  
await cache.forceRefresh('1')
```

### Forcing a specific value

In certain cases you may want to explicitly store a specific value in all of your caches layers. In that case you should use the `forceSetValue` method:

```ts
// This will set the value of all configured caches for the key "1" to a value "newValue", and fire a NotificationPublisher set value command, if publisher is set  
await cache.forceSetValue('1', 'newValue')
```

## Usage in high-performance systems

### Synchronous short-circuit

In case you are handling very heavy load and want to achieve highest possible performance, you can avoid asynchronous retrieval (and unnecessary Promise overhead) altogether in case there is a value already available in in-memory cache. Here is the example:

```ts
const loader = new Loader<MyValueType>({
  inMemoryCache: {
    // configuration here
  },

  // this cache will be checked if in-memory one returns undefined
  asyncCache: new RedisCache<MyValueType>(ioRedis, {
    // configuration here
  }),
  dataSources: [new MyDataSource()],
})

const cachedValue =
  // this very quickly checks if we have value in-memory
  loader.getInMemoryOnly('key') ||
  // if we don't, proceed with checking asynchronous cache and datasources
  (await loader.getAsyncOnly('key'))
```

Note that this will only work with truthy values. If you expect to get significant amount of falsy values (null for non-existing entries or 0/false), you should use an extended short-circuit syntax:

```ts
let cachedValue: MyValueType | undefined | null
cachedValue = loader.getInMemoryOnly('key')

if (cachedValue === undefined) {
  cachedValue = await loader.getAsyncOnly('key')
}
```

If you are unsure, whether you are caching significant amount of falsy or empty (null/empty string) values, you can enable cache statistics for discovering this data. See section "Cache statistics" for how to set that up.

### Preemptive background refresh

In case some of your datasource calls are very expensive, and you want to reduce response latency, you can start preemptively refreshing your cache in background while still serving not-yet-stale current data. In order to do so, you need to set parameter `ttlLeftBeforeRefreshInMsecs`.
For in-memory cache:

```ts
const operation = new Loader<string>({
  inMemoryCache: {
    cacheId: 'some-cache',
    ttlInMsecs: 1000 * 60,
    ttlLeftBeforeRefreshInMsecs: 1000 * 20, // this means that when there is a GET operation for the cache entry, and it has less than 20 seconds of TTL left, background refresh for this entry will start
  },
  // the rest of loader configuration
})
```

For Redis cache:

```ts
const asyncCache = new RedisCache<string>(redis, {
  ttlInMsecs: 1000 * 60,
  ttlLeftBeforeRefreshInMsecs: 1000 * 20,
}) // this means that when there is a GET operation for the cache entry, and it has less than 20 seconds of TTL left, background refresh for this entry will start
```

Note that there is overhead involved in performing refresh checks (especially for Redis). Always measure performance before and after enabling preemptive refresh in order to determine, whether it improves or worsens the performance of your system.
Bulk operations (`getMany()`) do not support preemptive background refresh.

## Group operations

### What are group operations?

A regular `Loader` stores every entry in a single, flat key space. Group operations let you partition that key space into named **groups**, so the same logical key can exist independently in different groups, and an entire group can be invalidated in one shot without touching the rest of the cache.

A group is just a string identifier you supply alongside the key. Every cache lookup, store and invalidation then takes both a `key` and a `group`:

- entries in different groups never collide, even when they share the same key;
- you can drop a whole group at once (`invalidateCacheForGroup`), which is much cheaper and safer than enumerating and deleting individual keys;
- you can still invalidate a single entry within a group (`invalidateCacheFor(key, group)`).

Group functionality is provided by `GroupLoader` and `ManualGroupCache`, which mirror `Loader` and `ManualCache` but add the extra `group` argument to their methods. The building blocks (`InMemoryGroupCache`, `RedisGroupCache`) and notification pairs (`createGroupNotificationPair`) all have group-aware counterparts.

### When should they be used?

Reach for group operations whenever cached entries naturally cluster into sets that are created, expired and invalidated **together**:

- **Multi-tenant data** - group by `tenantId` / `organizationId`, so you can flush a single tenant's cache (e.g. after a bulk import or a permissions change) without evicting everyone else;
- **Per-user or per-session collections** - group by `userId`, and clear everything cached for a user on logout or profile update;
- **Entities scoped to a parent** - group a parent's children (e.g. all line items of an order, all comments of a post) so updating the parent invalidates the whole set at once;
- **Versioned or namespaced datasets** - group by dataset/version, so swapping in a new version is a single group invalidation.

If your entries are unrelated and you only ever invalidate them one by one, a plain `Loader` is simpler and slightly faster - don't add a group dimension you won't use.

### How are they used?

`GroupLoader` is configured exactly like a `Loader`, except its data sources implement `getFromGroup` / `getManyFromGroup`, and its read/write/invalidate methods take a `group` argument:

```ts
import Redis from 'ioredis'
import { GroupLoader, RedisGroupCache } from 'layered-loader'
import type { GroupDataSource } from 'layered-loader'

const ioRedis = new Redis({
  host: 'localhost',
  port: 6379,
  password: 'sOmE_sEcUrE_pAsS',
})

class UsersDataSource implements GroupDataSource<User> {
  private readonly db: Knex
  name = 'Users DB loader'
  isCache = false

  constructor(db: Knex) {
    this.db = db
  }

  // `group` here is the organization id, `loadParams` is the user id
  async getFromGroup(userId: string, organizationId: string): Promise<User | undefined | null> {
    const results = await this.db('users')
      .select('*')
      .where({ id: userId, organization_id: organizationId })
    return results[0]
  }

  async getManyFromGroup(userIds: string[], organizationId: string): Promise<User[]> {
    return this.db('users')
      .select('*')
      .where({ organization_id: organizationId })
      .whereIn('id', userIds)
  }
}

const userLoader = new GroupLoader<User>({
  inMemoryCache: {
    ttlInMsecs: 1000 * 60,
    maxGroups: 1000, // how many groups to keep in memory
    maxItemsPerGroup: 500, // how many entries to keep per group
  },
  asyncCache: new RedisGroupCache<User>(ioRedis, {
    json: true,
    ttlInMsecs: 1000 * 60 * 10,
  }),
  dataSources: [new UsersDataSource(db)],
})

// retrieval - both key and group are required
const user = await userLoader.get('user-1', 'org-42')
const users = await userLoader.getMany(['user-1', 'user-2'], 'org-42')

// invalidate a single entry within a group
await userLoader.invalidateCacheFor('user-1', 'org-42')

// invalidate the entire group in one operation
await userLoader.invalidateCacheForGroup('org-42')
```

When a notification publisher/consumer pair (`createGroupNotificationPair`, see [Update notifications](#update-notifications)) is configured, both `invalidateCacheFor` and `invalidateCacheForGroup` are transparently propagated to every node of your distributed system, so in-memory caches everywhere stay consistent.

If you populate the cache yourself rather than through data sources, use `ManualGroupCache`, which exposes the same group-aware `getFromGroup` / `setForGroup` / `invalidateCacheForGroup` methods without the data-source layer.

### How is group invalidation handled efficiently?

The naive way to invalidate a group would be to find every key belonging to it and delete each one - in Redis that means a `SCAN`/`KEYS` sweep plus N deletes, which is slow and blocks the server as groups grow large. `layered-loader` avoids this entirely by using a **group index counter (generation marker)** instead.

For each group, the `RedisGroupCache` keeps a small integer counter at a dedicated index key (`<prefix>:group-index:<group>`). The current value of that counter is embedded into the key of every entry written for the group:

```
<prefix>:<group>:<groupIndexKey>:<key>
```

So a write first reads (or lazily initializes) the group's counter, then stores the entry under a key that includes the counter value. Reads do the same: they look up the current counter, then build the key and fetch it.

Invalidating the whole group (`deleteGroup`) simply **increments that counter** - a single O(1) `INCR`:

```ts
// effectively what deleteGroup does
await redis.incr('<prefix>:group-index:<group>')
```

After the increment, every previously written entry still physically exists in Redis but is now stored under the *old* counter value, so no subsequent read can ever construct its key again - the entire group becomes unreachable instantly, regardless of how many entries it held. The orphaned entries are reclaimed automatically by their own per-entry TTL, so no scan or bulk delete is ever needed.

A few consequences worth knowing:

- Group invalidation cost is constant (`O(1)`) and independent of group size; there is no `SCAN`/`KEYS` and no server-side blocking.
- Because old entries expire passively, you should keep a `ttlInMsecs` on the entries themselves so stale generations don't accumulate in memory.
- The group index keys themselves can optionally be expired via `groupTtlInMsecs`. Without it the index keys live forever, which is fine for a bounded number of groups; if you create groups unboundedly (millions, ever-growing), set `groupTtlInMsecs` so old index keys are eventually reclaimed. Note that adding new entries to a group does **not** reset that TTL.
- The in-memory tier mirrors the same semantics: each group is a separate sub-cache, so `invalidateCacheForGroup` is a single map delete, and `maxGroups` / `maxItemsPerGroup` bound memory usage.

## Provided async caches

### RedisCache

`RedisCache` uses Redis for caching data, and is recommended for highly distributed systems. It requires an active instance of `ioredis`, and it does not perform any connection/disconnection operations on its own.
It has following configuration options:

- `prefix: string` - what prefix should be added to all keys in this cache. Used to differentiate among different groups of entities within single Redis DB (serving as a pseudo-table);
- `ttlInMsecs: number` - after how many milliseconds data will be considered stale and will no longer be accessible;
- `groupTtlInMsecs: number` - after how many milliseconds entire group will be considered stale and will no longer be accessible. For non-huge amount of groups (if you have less than a million, you have nothing to worry about) it is generally recommended not to set TTL, but if there is a huge amount of them, and more are added often, you may eventually run out of memory if you never expire groups, as you will keep accumulating their prefix identifiers in your Redis. Note that adding new entries to a group does not reset its TTL.";
- `json: boolean` - if false, all passed data will be sent to Redis and returned from it as-is. If true, it will be serialized using `JSON.stringify` and deserialized, using `JSON.parse`;
- `timeoutInMsecs?: number` - if set, Redis operations will automatically fail after specified execution threshold in milliseconds is exceeded. Next data source in the sequence will be used instead.
- `separator?: number` - What text should be used between different parts of the key prefix. Default is `':'`
- `ttlLeftBeforeRefreshInMsecs?: number` - if set within a Loader or GroupLoader, when remaining ttl is equal or lower to specified value, loading will be started in background, and all caches will be updated. It is recommended to set this value for heavy loaded system, to prevent requests from stalling while cache refresh is happening.

## Redis connection safety

### Automatic READONLY reconnection

When using `createNotificationPair` or `createGroupNotificationPair` with `RedisOptions` (rather than pre-instantiated Redis clients), the library automatically enriches the Redis configuration with a `reconnectOnError` handler that triggers reconnection when a `READONLY` error is detected. This addresses a common issue during **blue-green deployments** or managed Redis failovers, where the current master is demoted to a replica and starts rejecting write commands with `READONLY` errors.

If you provide your own `reconnectOnError` in the `RedisOptions`, it will be preserved and the default handler will not be applied.

### Using `enrichRedisConfig` for your own connections

When creating Redis instances manually (e.g. for `RedisCache`), you can use the exported `enrichRedisConfig` utility to apply the same safety logic:

```ts
import Redis from 'ioredis'
import { enrichRedisConfig, RedisCache } from 'layered-loader'

const redisOptions = {
  host: 'localhost',
  port: 6379,
  password: 'sOmE_sEcUrE_pAsS',
}

const redis = new Redis(enrichRedisConfig(redisOptions))

const cache = new RedisCache<string>(redis, {
  json: true,
  ttlInMsecs: 1000 * 60 * 10,
})
```

### Cloud-optimized configuration

For managed Redis cluster services (AWS ElastiCache, GCP Memorystore, etc.), use `enrichRedisConfigOptimizedForCloud` instead. It accepts `ClusterOptions` and, in addition to the `READONLY` reconnection handler (set via `redisOptions`), forces IPv4 DNS resolution so that after a failover the DNS record resolves to the new master instead of using a cached or stale address:

```ts
import Redis from 'ioredis'
import { enrichRedisConfigOptimizedForCloud } from 'layered-loader'

const cluster = new Redis.Cluster(
  [{ host: 'my-cluster.cache.amazonaws.com', port: 6379 }],
  enrichRedisConfigOptimizedForCloud({})
)
```

Both `enrichRedisConfig` and `enrichRedisConfigOptimizedForCloud` preserve any user-provided `reconnectOnError` or `dnsLookup` handlers.
