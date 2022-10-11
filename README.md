# layered-loader

[![npm version](http://img.shields.io/npm/v/layered-loader.svg)](https://npmjs.org/package/layered-loader)
![](https://github.com/kibertoad/layered-loader/workflows/ci/badge.svg)
[![Coverage Status](https://coveralls.io/repos/kibertoad/layered-loader/badge.svg?branch=main)](https://coveralls.io/r/kibertoad/layered-loader?branch=main)

Data source agnostic data loader with support for caching and fallback data sources.

## Prerequisites

Node: 16+

## Use-cases

This library has three main goals:

1. Provide transparent, highly flexible caching mechanism for data retrieval operations;
2. Enable fallback mechanism for retrieving data when alternate sources exist;
3. Prevent redundant data retrieval in high-load systems.

## Basic concepts

There are three entity types used by `layered-loader`:

1. **LoadingOperation** - defined procedure of retrieving data from one or more data sources, using a single key. LoadingOperation is composed of Loaders and Caches.
2. **Loader** - data source, capable of retrieving data for a given key, synchronously or asynchronously.
3. **Cache** - data source, capable of both storing and retrieving data for a given key, synchronously or asynchronously.

- `layered-loader` will try loading the data from the first cache or loader defined for the LoadingOperation. In case `undefined` value is the result of retrieval, next data source in sequence will be used, until there is either a value, or there are no more sources available;
- `null` is considered to be a value, and if the data source returns it, subsequent data source will not be queried for data;
- If non-last data source throws an error, it is handled using configured ErrorHandler. If the last data source throws an error, and there are no remaining fallback data sources, an error will be thrown by the LoadingOperation.
- If there are any caches preceding the data source that returned a value, all of them will be updated with that value;
- If there is an ongoing retrieval operation for the given key, promise for that retrieval will be reused and returned as a result of `loadingOperation.get`, instead of starting a new retrieval.

## Basic example

Let's define a loader, which will be the primary source of truth, and two levels of caching:

```ts
import Redis from 'ioredis'
import { RedisCache } from 'layered-loader/dist/lib/redis'
import { InMemoryCache } from 'layered-loader/dist/lib/memory'
import type { Loader } from 'layered-loader'

const ioRedis = new Redis({
  host: 'localhost',
  port: 6379,
  password: 'sOmE_sEcUrE_pAsS',
})

class ClassifiersLoader implements Loader<Record<string, any>> {
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
}

const operation = new LoadingOperation<string>([
  new InMemoryCache<string>({
    ttlInMsecs: 1000 * 60,
    maxItems: 100,
  }), // this cache will be checked first
  new RedisCache(ioRedis, {
    json: true, // this instructs loader to serialize passed objects as string and deserialize them back to objects
    ttlInMsecs: 1000 * 60 * 10,
  }), // this cache will be checked second
  new ClassifiersLoader(db), // this will be used if neither cache has the requested data
])

// If cache is empty, but there is data in the DB, after this operation is completed, both caches will be populated
const classifier = await operation.get('1')
```

## LoadingOperation API

LoadingOperation has the following config parameters:

- `throwIfUnresolved: boolean` - if true, error will be thrown if all data sources return `undefined`;
- `cacheUpdateErrorHandler: LoaderErrorHandler` - error handler to use when cache throws an error during update;
- `loadErrorHandler: LoaderErrorHandler` - error handler to use when non-last data source throws an error during data retrieval.

LoadingOperation provides following methods:

- `invalidateCacheFor(key: string): Promise<void>` - expunge all entries for given key from all caches of this LoadingOperation;
- `invalidateCache(): Promise<void>` - expunge all entries from all caches of this LoadingOperation;
- `get(key: string): Promise<T>` - sequentially attempt to retrieve data for specified key from all caches and loaders, in an order in which they were passed to the LoadingOperation constructor.

## Provided caches

### InMemoryCache

In order to use `InMemoryCache`, please install `tiny-lru`:

```shell
npm install 'tiny-lru' --save
```

`InMemoryCache` stores data in-memory, and as such is not recommended for usage in highly-distributed systems for data that is modified frequently.
It has following configuration options:

- `ttlInMsecs: number` - after how many milliseconds data will be considered stale and will no longer be accessible;
- `maxItems: number` - what is the maximum amount of items that can be retained in cache at the same time. Entries are being evoked based on LRU (least recently used) principle.

### RedisCache

`RedisCache` uses Redis for caching data, and is recommended for highly distributed systems. It requires an active instance of `ioredis`, and it does not perform any connection/disconnection operations on its own.
It has following configuration options:

- `ttlInMsecs: number` - after how many milliseconds data will be considered stale and will no longer be accessible;
- `json: boolean` - if false, all passed data will be sent to Redis and returned from it as-is. If true, it will be serialized using `JSON.stringify` and deserialized, using `JSON.parse`.

## Supported environments

`LoadingOperation` and `InMemoryCache` support both browser and Node.js (ES6 support is required);
`RedisCache` only works in Node.js;
Tree-shaking should work correctly, but wasn't tested.
