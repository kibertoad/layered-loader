import { LoadingOperation } from '../lib/LoadingOperation'
import { InMemoryCacheConfiguration } from '../lib/memory/InMemoryCache'
import { DummyLoader } from './utils/DummyLoader'
import { CountingLoader } from './utils/CountingLoader'
import { ThrowingLoader } from './utils/ThrowingLoader'
import { ThrowingCache } from './utils/ThrowingCache'
import { TemporaryThrowingLoader } from './utils/TemporaryThrowingLoader'
import { DummyCache } from './utils/DummyCache'

const IN_MEMORY_CACHE_CONFIG = { ttlInMsecs: 999 } satisfies InMemoryCacheConfiguration

describe('LoadingOperation', () => {
  beforeEach(() => {
    jest.resetAllMocks()
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
  })

  describe('get', () => {
    it('returns undefined when fails to resolve value', async () => {
      const operation = new LoadingOperation({})

      const result = await operation.get('value')

      expect(result).toBe(undefined)
    })

    it('throws when fails to resolve value and flag is set', async () => {
      const operation = new LoadingOperation({
        throwIfUnresolved: true,
      })

      await expect(() => {
        return operation.get('value')
      }).rejects.toThrow(/Failed to resolve value for key "value"/)
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
      expect(value).toBeUndefined()

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

    it('correctly handles error during cache update', async () => {
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
