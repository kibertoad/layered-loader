import { setTimeout } from 'timers/promises'
import { LoadingOperation } from '../lib/LoadingOperation'
import { InMemoryCacheConfiguration } from '../lib/memory/InMemoryCache'
import { DummyLoader } from './fakes/DummyLoader'
import { CountingLoader } from './fakes/CountingLoader'
import { ThrowingLoader } from './fakes/ThrowingLoader'
import { ThrowingCache } from './fakes/ThrowingCache'
import { TemporaryThrowingLoader } from './fakes/TemporaryThrowingLoader'
import { DummyCache } from './fakes/DummyCache'
import { DummyLoaderParams, DummyLoaderWithParams } from './fakes/DummyLoaderWithParams'
import { RedisCache } from '../lib/redis'
import Redis from 'ioredis'
import { redisOptions } from './fakes/TestRedisConfig'

const IN_MEMORY_CACHE_CONFIG = { ttlInMsecs: 999 } satisfies InMemoryCacheConfiguration

describe('LoadingOperation', () => {
  let redis: Redis
  beforeEach(async () => {
    jest.resetAllMocks()
    redis = new Redis(redisOptions)
    await redis.flushall()
  })

  afterEach(async () => {
    await redis.disconnect()
  })

  describe('getInMemoryOnly', () => {
    it('returns undefined when no inmemory cache is configured', () => {
      const operation = new LoadingOperation({})

      const result = operation.getInMemoryOnly('value')

      expect(result).toBe(undefined)
    })

    it('returns undefined when no value is cached', () => {
      const operation = new LoadingOperation({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      })

      const result = operation.getInMemoryOnly('value')

      expect(result).toBe(undefined)
    })

    it('returns cached value', async () => {
      const operation = new LoadingOperation({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyCache('value'),
      })

      const resultPre = operation.getInMemoryOnly('key')
      await operation.getAsyncOnly('key')
      const resultPost = operation.getInMemoryOnly('key')

      expect(resultPre).toBeUndefined()
      expect(resultPost).toBe('value')
    })

    it('triggers background refresh when threshold is set and reached', async () => {
      const loader = new CountingLoader('value')

      const operation = new LoadingOperation<string>({
        inMemoryCache: {
          ttlInMsecs: 150,
          ttlLeftBeforeRefreshInMsecs: 75,
        },
        loaders: [loader],
      })
      expect(operation.getInMemoryOnly('key')).toBeUndefined()
      expect(loader.counter).toBe(0)
      expect(await operation.get('key')).toBe('value')
      expect(loader.counter).toBe(1)
      // @ts-ignore
      const expirationTimePre = operation.inMemoryCache.getExpirationTime('key')

      await setTimeout(100)
      expect(loader.counter).toBe(1)
      // kick off the refresh
      expect(operation.getInMemoryOnly('key')).toBe('value')
      await Promise.resolve()
      expect(loader.counter).toBe(2)
      // @ts-ignore
      const expirationTimePost = operation.inMemoryCache.getExpirationTime('key')

      expect(operation.getInMemoryOnly('key')).toBe('value')
      await Promise.resolve()
      expect(loader.counter).toBe(2)
      expect(expirationTimePre).toBeDefined()
      expect(expirationTimePost).toBeDefined()
      expect(expirationTimePost! > expirationTimePre!).toBe(true)
    })

    it('triggers async background refresh when threshold is set and reached', async () => {
      const loader = new CountingLoader('value')
      const asyncCache = new RedisCache<string>(redis, {
        ttlInMsecs: 150,
        ttlLeftBeforeRefreshInMsecs: 75,
      })

      const operation = new LoadingOperation<string>({
        asyncCache,
        loaders: [loader],
      })
      // @ts-ignore
      expect(await operation.asyncCache.get('key')).toBeUndefined()
      expect(loader.counter).toBe(0)
      expect(await operation.get('key')).toBe('value')
      expect(loader.counter).toBe(1)
      // @ts-ignore
      const expirationTimePre = await operation.asyncCache.getExpirationTime('key')

      await setTimeout(100)
      expect(loader.counter).toBe(1)
      // kick off the refresh
      expect(await operation.get('key')).toBe('value')
      await Promise.resolve()
      expect(loader.counter).toBe(2)
      // @ts-ignore
      const expirationTimePost = await operation.asyncCache.getExpirationTime('key')

      expect(await operation.get('key')).toBe('value')
      await Promise.resolve()
      expect(loader.counter).toBe(2)
      expect(expirationTimePre).toBeDefined()
      expect(expirationTimePost).toBeDefined()
      expect(expirationTimePost! > expirationTimePre!).toBe(true)
    })

    it('async background refresh errors do not crash app', async () => {
      const loader = new CountingLoader('value')
      const asyncCache = new RedisCache<string>(redis, {
        ttlInMsecs: 150,
        ttlLeftBeforeRefreshInMsecs: 75,
      })

      const operation = new LoadingOperation<string>({
        asyncCache,
        loaders: [loader],
        throwIfUnresolved: true,
      })
      // @ts-ignore
      expect(await operation.asyncCache.get('key')).toBeUndefined()
      expect(loader.counter).toBe(0)
      expect(await operation.get('key')).toBe('value')
      expect(loader.counter).toBe(1)

      await setTimeout(100)
      expect(loader.counter).toBe(1)
      loader.value = undefined
      // kick off the refresh
      expect(await operation.get('key')).toBe('value')
      await setTimeout(100)
      await expect(() => operation.get('key')).rejects.toThrow(/Failed to resolve value for key "key"/)
      await Promise.resolve()
      expect(loader.counter).toBe(3)
    })
  })

  describe('get', () => {
    it('returns undefined when fails to resolve value', async () => {
      const operation = new LoadingOperation({})

      const result = await operation.get('value')

      expect(result).toBe(undefined)
    })

    it('throws when fails to resolve value, no loaders and flag is set', async () => {
      const operation = new LoadingOperation({
        throwIfUnresolved: true,
      })

      await expect(() => {
        return operation.get('value')
      }).rejects.toThrow(/Failed to resolve value for key "value"/)
    })

    it('throws when fails to resolve value, and flag is set', async () => {
      const operation = new LoadingOperation({
        throwIfUnresolved: true,
        loaders: [new DummyLoader(undefined)],
      })

      await expect(() => {
        return operation.get('value')
      }).rejects.toThrow(/Failed to resolve value for key "value"/)
    })

    it('does not throw when flag is set, but loader can resolve the value', async () => {
      const cache = new DummyCache(undefined)
      const loader = new DummyLoader('value')

      const operation = new LoadingOperation({
        asyncCache: cache,
        loaders: [loader],
        throwIfUnresolved: true,
      })

      const value = await operation.get('key')
      expect(value).toEqual('value')
    })

    it('logs error during load', async () => {
      const consoleSpy = jest.spyOn(console, 'error')
      const operation = new LoadingOperation({ loaders: [new ThrowingLoader()], throwIfLoadError: true })

      await expect(() => {
        return operation.get('value')
      }).rejects.toThrow(/Error has occurred/)
      expect(consoleSpy).toHaveBeenCalledTimes(1)
    })

    it('resets loading operation after value was not found previously', async () => {
      const loader = new DummyLoader(undefined)
      const operation = new LoadingOperation({ loaders: [loader] })

      const value = await operation.get('value')
      expect(value).toBeNull()

      loader.value = null
      const value2 = await operation.get('value')
      expect(value2).toBeNull()

      loader.value = 'value'
      const value3 = await operation.get('dummy')
      expect(value3).toBe('value')
    })

    it('resets loading operation after error during load', async () => {
      const loader = new TemporaryThrowingLoader('value')
      const operation = new LoadingOperation({ loaders: [loader] })

      await expect(() => {
        return operation.get('value')
      }).rejects.toThrow(/Error has occurred/)

      loader.isThrowing = false
      const value = await operation.get('dummy')
      expect(value).toBe('value')
    })

    it('handles error during cache update', async () => {
      const consoleSpy = jest.spyOn(console, 'error')
      const operation = new LoadingOperation({ asyncCache: new ThrowingCache(), loaders: [new DummyLoader('value')] })
      const value = await operation.get('value')
      expect(value).toBe('value')
      expect(consoleSpy).toHaveBeenCalledTimes(2)
    })

    it('returns value when resolved via single loader', async () => {
      const operation = new LoadingOperation<string>({ inMemoryCache: IN_MEMORY_CACHE_CONFIG })
      // @ts-ignore
      operation.inMemoryCache.set('key', 'value')

      const result = await operation.get('key')

      expect(result).toBe('value')
    })

    it('returns value when resolved via multiple loaders', async () => {
      const asyncCache = new DummyCache(undefined)

      const operation = new LoadingOperation<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: asyncCache,
      })
      await asyncCache.set('key', 'value')

      const result = await operation.get('key')

      expect(result).toBe('value')
    })

    it('updates upper level cache when resolving value downstream', async () => {
      const cache2 = new DummyCache(undefined)
      const operation = new LoadingOperation<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        loaders: [new DummyLoader(undefined), new DummyLoader('value')],
      })
      // @ts-ignore
      const cache1 = operation.inMemoryCache

      const valuePre = await cache1.get('key')
      await operation.get('key')
      const valuePost = await cache1.get('key')
      const valuePost2 = await cache2.get('key')

      expect(valuePre).toBe(undefined)
      expect(valuePost).toBe('value')
      expect(valuePost2).toBe('value')
    })

    it('passes loadParams to the loader', async () => {
      const cache2 = new DummyCache(undefined)
      const operation = new LoadingOperation<string, DummyLoaderParams>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        loaders: [new DummyLoaderWithParams('value')],
      })
      // @ts-ignore
      const cache1 = operation.inMemoryCache

      const valuePre = await cache1.get('key')
      await operation.get('key', { prefix: 'pre', suffix: 'post' })
      const valuePost = await cache1.get('key')
      const valuePost2 = await cache2.get('key')

      expect(valuePre).toBe(undefined)
      expect(valuePost).toBe('prevaluepost')
      expect(valuePost2).toBe('prevaluepost')
    })

    it('correctly reuses value from cache', async () => {
      const cache2 = new DummyCache(undefined)
      const loader1 = new CountingLoader(undefined)
      const loader2 = new CountingLoader('value')

      const operation = new LoadingOperation<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        loaders: [loader1, loader2],
      })

      const valuePre = await operation.get('key')
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe('value')
      expect(loader2.counter).toBe(1)
    })

    it('batches identical retrievals together', async () => {
      const loader = new CountingLoader('value')

      const operation = new LoadingOperation<string>({ loaders: [loader] })
      const valuePromise = operation.get('key')
      const valuePromise2 = operation.get('key')

      const value = await valuePromise
      const value2 = await valuePromise2

      expect(value).toBe('value')
      expect(value2).toBe('value')
      expect(loader.counter).toBe(1)
    })
  })

  describe('invalidateCacheFor', () => {
    it('correctly invalidates cache', async () => {
      const cache2 = new DummyCache(undefined)
      const loader1 = new CountingLoader(undefined)
      const loader2 = new CountingLoader('value')

      const operation = new LoadingOperation<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        loaders: [loader1, loader2],
      })

      const valuePre = await operation.get('key')
      await operation.invalidateCacheFor('key')
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe('value')
      expect(loader2.counter).toBe(2)
    })

    it('correctly handles errors during invalidation', async () => {
      const cache2 = new ThrowingCache()
      const loader1 = new CountingLoader(undefined)
      const loader2 = new CountingLoader('value')

      const operation = new LoadingOperation<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        loaders: [loader1, loader2],
      })

      const valuePre = await operation.get('key')

      await operation.invalidateCacheFor('key')
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe('value')
      expect(loader2.counter).toBe(2)
    })
  })

  describe('invalidateCache', () => {
    it('correctly invalidates cache', async () => {
      const cache2 = new DummyCache(undefined)
      const loader1 = new CountingLoader(undefined)
      const loader2 = new CountingLoader('value')

      const operation = new LoadingOperation<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        loaders: [loader1, loader2],
      })

      const valuePre = await operation.get('key')

      await operation.invalidateCache()
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe('value')
      expect(loader2.counter).toBe(2)
    })

    it('correctly handles errors during invalidation', async () => {
      const cache2 = new ThrowingCache()
      const loader1 = new CountingLoader(undefined)
      const loader2 = new CountingLoader('value')

      const operation = new LoadingOperation<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        loaders: [loader1, loader2],
      })

      const valuePre = await operation.get('key')

      await operation.invalidateCache()
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe('value')
      expect(loader2.counter).toBe(2)
    })
  })
})
