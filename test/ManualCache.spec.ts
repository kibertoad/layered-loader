import type { InMemoryCacheConfiguration } from '../lib/memory/InMemoryCache'
import { ThrowingCache } from './fakes/ThrowingCache'
import { ManualCache } from '../lib/ManualCache'
import { DummyCache } from './fakes/DummyCache'
import { CountingCache } from './fakes/CountingCache'
import { TemporaryThrowingCache } from './fakes/TemporaryThrowingCache'

const IN_MEMORY_CACHE_CONFIG = { ttlInMsecs: 999 } satisfies InMemoryCacheConfiguration

describe('ManualCache', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  describe('set', () => {
    it('handles error when trying to set a value', async () => {
      const operation = new ManualCache<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new ThrowingCache(),
      })

      await operation.set('value', 'someValue')

      const result = await operation.get('value')
      expect(result).toBe('someValue')
    })
  })

  describe('get', () => {
    it('returns undefined when fails to resolve value', async () => {
      const operation = new ManualCache({})

      const result = await operation.get('value')

      expect(result).toBe(undefined)
    })

    it('logs error during load', async () => {
      const consoleSpy = jest.spyOn(console, 'error')
      const operation = new ManualCache({ asyncCache: new ThrowingCache() })

      await operation.get('value')

      expect(consoleSpy).toHaveBeenCalledTimes(1)
    })

    it('resets loading operation after value was not found previously', async () => {
      const cache = new DummyCache(undefined)
      const operation = new ManualCache({ asyncCache: cache })

      const value = await operation.get('dummy')
      expect(value).toBeUndefined()

      cache.value = null
      const value2 = await operation.get('dummy')
      expect(value2).toBeNull()

      cache.value = 'value'
      const value3 = await operation.get('dummy')
      expect(value3).toBe('value')
    })

    it('resets loading operation after error during load', async () => {
      const cache = new TemporaryThrowingCache('value')
      const operation = new ManualCache({ asyncCache: cache })

      const preValue = await operation.get('value')
      expect(preValue).toBeUndefined()

      cache.isThrowing = false
      const value = await operation.get('dummy')
      expect(value).toBe('value')
    })

    it('correctly handles error during cache update', async () => {
      const consoleSpy = jest.spyOn(console, 'error')
      const operation = new ManualCache({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new ThrowingCache(),
      })

      await operation.set('key', 'value')

      const value = await operation.get('key')
      expect(value).toBe('value')
      expect(consoleSpy).toHaveBeenCalledTimes(1)
    })

    it('returns value when resolved via single loader', async () => {
      const operation = new ManualCache<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      })
      // @ts-ignore
      const cache = operation.inMemoryCache
      await cache.set('key', 'value')

      const result = await operation.get('key')

      expect(result).toBe('value')
    })

    it('returns value when resolved via multiple loaders', async () => {
      const cache2 = new DummyCache(undefined)

      const operation = new ManualCache<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
      })
      await cache2.set('key', 'value')

      const result = await operation.get('key')

      expect(result).toBe('value')
    })

    it('updates upper level cache when resolving value downstream', async () => {
      const cache2 = new DummyCache(undefined)

      const operation = new ManualCache<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
      })
      // @ts-ignore
      const cache1 = operation.inMemoryCache

      const valuePre = await cache1.get('key')
      await operation.set('key', 'value')
      const valuePost = await cache1.get('key')
      const valuePost2 = await cache2.get('key')

      expect(valuePre).toBe(undefined)
      expect(valuePost).toBe('value')
      expect(valuePost2).toBe('value')
    })

    it('correctly reuses value from cache', async () => {
      const loader2 = new CountingCache('value')

      const operation = new ManualCache<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: loader2,
      })
      const valuePre = await operation.get('key')
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe('value')
      expect(loader2.counter).toBe(1)
    })

    it('batches identical retrievals together', async () => {
      const loader = new CountingCache('value')

      const operation = new ManualCache<string>({
        asyncCache: loader,
      })
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
      const loader2 = new CountingCache('value')

      const operation = new ManualCache<string>({
        asyncCache: loader2,
      })
      const valuePre = await operation.get('key')

      await operation.invalidateCacheFor('key')
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe(undefined)
      expect(loader2.counter).toBe(2)
    })

    it('correctly handles errors during invalidation', async () => {
      const cache2 = new TemporaryThrowingCache('value')

      const operation = new ManualCache<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
      })
      cache2.isThrowing = false
      const valuePre = await operation.get('key')
      cache2.isThrowing = true

      await operation.invalidateCacheFor('key')
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe(undefined)
    })
  })

  describe('invalidateCache', () => {
    it('correctly invalidates cache', async () => {
      const loader2 = new CountingCache('value')

      const operation = new ManualCache<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: loader2,
      })
      const valuePre = await operation.get('key')

      await operation.invalidateCache()
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe(undefined)
      expect(loader2.counter).toBe(2)
    })

    it('correctly handles errors during invalidation', async () => {
      const cache2 = new TemporaryThrowingCache('value')
      cache2.isThrowing = false

      const operation = new ManualCache<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
      })
      const valuePre = await operation.get('key')

      cache2.isThrowing = true
      await operation.invalidateCache()
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe(undefined)
    })
  })
})
