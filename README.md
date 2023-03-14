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

There are four entity types used by `layered-loader`:

1. **LoadingOperation** - defined procedure of retrieving data from one or more data sources, using a single key. LoadingOperation is composed of Loaders and Caches.
2. **InMemoryCache** - data source, capable of both storing and retrieving data for a given key synchronously.
3. **AsyncCache** - data source, capable of both storing and retrieving data for a given key asynchronously.
4. **Loader** - data source, capable of retrieving data for a given key asynchronously.

- `layered-loader` will try loading the data from the data source defined for the LoadingOperation, in the following order: InMemory, AsyncCache, Loaders. In case `undefined` value is the result of retrieval, next data source in sequence will be used, until there is either a value, or there are no more sources available;
- `null` is considered to be a value, and if the data source returns it, subsequent data source will not be queried for data;
- If non-last data source throws an error, it is handled using configured ErrorHandler. If the last data source throws an error, and there are no remaining fallback data sources, an error will be thrown by the LoadingOperation.
- If there are any caches (InMemory or AsyncCache) preceding the data source that returned a value, all of them will be updated with that value;
- If there is an ongoing retrieval operation for the given key, promise for that retrieval will be reused and returned as a result of `loadingOperation.get`, instead of starting a new retrieval.
- You can use just the memory cache, just the asynchronous one, neither, or both. Unconfigured layer will be simply skipped for all operations (both storage and retrieval).

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

const operation = new LoadingOperation<string>({
    // this cache will be checked first
    inMemoryCache: {
        ttlInMsecs: 1000 * 60,
        maxItems: 100,
    },

    // this cache will be checked if in-memory one returns undefined
    asyncCache: new RedisCache(ioRedis, {
        json: true, // this instructs loader to serialize passed objects as string and deserialize them back to objects
        ttlInMsecs: 1000 * 60 * 10,
    }),
    
    // this will be used if neither cache has the requested data
    loaders: [new ClassifiersLoader(db)] 
})

// If cache is empty, but there is data in the DB, after this operation is completed, both caches will be populated
const classifier = await operation.get('1')
```

## LoadingOperation API

LoadingOperation has the following config parameters:

- `throwIfUnresolved: boolean` - if true, error will be thrown if all data sources return `undefined`;
- `throwIfLoadError: boolean` - if true, error will be thrown if any Loader throws an error;
- `cacheUpdateErrorHandler: LoaderErrorHandler` - error handler to use when cache throws an error during update;
- `loadErrorHandler: LoaderErrorHandler` - error handler to use when non-last data source throws an error during data retrieval.

LoadingOperation provides following methods:

- `invalidateCacheFor(key: string): Promise<void>` - expunge all entries for given key from all caches of this LoadingOperation;
- `invalidateCache(): Promise<void>` - expunge all entries from all caches of this LoadingOperation;
- `get(key: string, loadParams?: P): Promise<T>` - sequentially attempt to retrieve data for specified key from all caches and loaders, in an order in which they were passed to the LoadingOperation constructor.

## Parametrized loading

Sometimes you need to pass additional parameters for loader in case it will need to refill the cache, such as JWT token (for external calls) or additional query parameters (for a DB call).
You can use optional parameter `loadParams` for that:

```ts
class MyLoaderWithParams implements Loader<string, MyLoaderParams> {
    async get(key: string, params?: MyLoaderParams): Promise<string | undefined | null> {
        if (!params) {
            throw new Error('Params were not passed')
        }

        const resolvedValue = await someResolutionLogic(params.jwtToken)
        return resolvedValue
    }
}

const operation = new LoadingOperation<string, MyLoaderParams>({
  inMemoryCache: IN_MEMORY_CACHE_CONFIG,
  loaders: [new MyParametrizedLoader()],
})
await operation.get('key', { jwtToken: 'someTokenValue' }) 
```

## Cache-only operations

Sometimes you may want to avoid implementing loader in the chain (e. g. when retrieval is too complex to be fit into a single key paradigm),
while still having a sequence of caches. In that case you can define a caching operation:

```ts
const operation = new CachingOperation<string>({
    // this cache will be checked first
    inMemoryCache: {
        ttlInMsecs: 1000 * 60,
        maxItems: 100,
    },

    // this cache will be checked if in-memory one returns undefined
    asyncCache: new RedisCache(ioRedis, {
        json: true, // this instructs loader to serialize passed objects as string and deserialize them back to objects
        ttlInMsecs: 1000 * 60 * 10,
    }),
})

// this will populate all caches
await operation.set('1', 'someValue')

// If any of the caches are still populated at the moment of this operation, 'someValue' will propagate across all caches 
const classifier = await operation.get('1')
```

Note that LoadingOperations are generally recommended over CachingOperations, as they offer better performance: LoadingOperations deduplicate all the get requests that come during the window between checking the cache and populating it, while Caching Operation will resolve all of them to undefined after checking the cache, both increasing load on the cache, and also potentially invoking the loading logic multiple times.

## Usage in high-performance systems

In case you are handling very heavy load and want to achieve highest possible performance, you can avoid asynchronous retrieval altogether in case there is a value already available in in-memory cache. Here is the example:
```ts
const operation = new CachingOperation<string>({
    inMemoryCache: {
        // configuration here
    },

    // this cache will be checked if in-memory one returns undefined
    asyncCache: new RedisCache(ioRedis, {
        // configuration here
    }),
})

const cachedValue = 
    // this very quickly checks if we have value in-memory
    operation.getInMemoryOnly('key')
    // if we don't, proceed with checking asynchronous caches (and loaders, if configured)
    || await operation.getAsyncOnly('key')
```

## Provided async caches

### RedisCache

`RedisCache` uses Redis for caching data, and is recommended for highly distributed systems. It requires an active instance of `ioredis`, and it does not perform any connection/disconnection operations on its own.
It has following configuration options:

- `prefix: string` - what prefix should be added to all keys in this cache. Used to differentiate among different groups of entities within single Redis DB (serving as a pseudo-table);
- `ttlInMsecs: number` - after how many milliseconds data will be considered stale and will no longer be accessible;
- `json: boolean` - if false, all passed data will be sent to Redis and returned from it as-is. If true, it will be serialized using `JSON.stringify` and deserialized, using `JSON.parse`;
- `timeoutInMsecs?: number` - if set, Redis operations will automatically fail after specified execution threshold in milliseconds is exceeded. Next data source in the sequence will be used instead.
- `separator?: number` - What text should be used between different parts of the key prefix. Default is `':'`

## Supported environments

`LoadingOperation` and `InMemoryCache` support both browser and Node.js (ES6 support is required);
`RedisCache` only works in Node.js;
Tree-shaking should work correctly, but wasn't tested.
