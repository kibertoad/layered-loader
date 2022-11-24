import { InMemoryCache } from '../lib/memory/InMemoryCache'
import { ThrowingCache } from './utils/ThrowingCache'
import { CachingOperation } from '../lib/CachingOperation'
import { DummyCache } from './utils/DummyCache'
import { CountingCache } from './utils/CountingCache'
import { TemporaryThrowingCache } from './utils/TemporaryThrowingCache'

describe('CachingOperation', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  describe('set', () => {
    it('handles error when trying to set a value', async () => {
      const operation = new CachingOperation<string>([new ThrowingCache(), new InMemoryCache()])

      await operation.set('value', 'someValue')

      const result = await operation.get('value')
      expect(result).toBe('someValue')
    })
  })

  describe('get', () => {
    it('returns undefined when fails to resolve value', async () => {
      const operation = new CachingOperation([])

      const result = await operation.get('value')

      expect(result).toBe(undefined)
    })

    it('logs error during load', async () => {
      const consoleSpy = jest.spyOn(console, 'error')
      const operation = new CachingOperation([new ThrowingCache()])

      await expect(() => {
        return operation.get('value')
      }).rejects.toThrow(/Error has occurred/)
      expect(consoleSpy).toHaveBeenCalledTimes(1)
    })

    it('resets loading operation after value was not found previously', async () => {
      const cache = new DummyCache(undefined)
      const operation = new CachingOperation([cache], {
        loadingOperationMemoryTtl: 999999,
      })

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
      const operation = new CachingOperation([cache], {
        loadingOperationMemoryTtl: 999999,
      })

      await expect(() => {
        return operation.get('value')
      }).rejects.toThrow(/Error has occurred/)

      cache.isThrowing = false
      const value = await operation.get('dummy')
      expect(value).toBe('value')
    })

    it('correctly handles error during cache update', async () => {
      const consoleSpy = jest.spyOn(console, 'error')
      const operation = new CachingOperation([new ThrowingCache(), new DummyCache('value')])
      const value = await operation.get('value')
      expect(value).toBe('value')
      expect(consoleSpy).toHaveBeenCalledTimes(2)
    })

    it('returns value when resolved via single loader', async () => {
      const cache = new InMemoryCache<string>()
      const operation = new CachingOperation<string>([cache])
      await cache.set('key', 'value')

      const result = await operation.get('key')

      expect(result).toBe('value')
    })

    it('returns value when resolved via multiple loaders', async () => {
      const cache1 = new InMemoryCache<string>()
      const cache2 = new InMemoryCache<string>()

      const operation = new CachingOperation<string>([cache1, cache2])
      await cache2.set('key', 'value')

      const result = await operation.get('key')

      expect(result).toBe('value')
    })

    it('updates upper level cache when resolving value downstream', async () => {
      const cache1 = new InMemoryCache<string>()
      const cache2 = new InMemoryCache<string>()

      const operation = new CachingOperation<string>([cache1, cache2])
      const valuePre = await cache1.get('key')
      await operation.set('key', 'value')
      const valuePost = await cache1.get('key')
      const valuePost2 = await cache2.get('key')

      expect(valuePre).toBe(undefined)
      expect(valuePost).toBe('value')
      expect(valuePost2).toBe('value')
    })

    it('correctly reuses value from cache', async () => {
      const cache1 = new InMemoryCache<string>()
      const cache2 = new InMemoryCache<string>()
      const loader1 = new CountingCache(undefined)
      const loader2 = new CountingCache('value')

      const operation = new CachingOperation<string>([cache1, cache2, loader1, loader2])
      const valuePre = await operation.get('key')
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe('value')
      expect(loader2.counter).toBe(1)
    })

    it('batches identical retrievals together', async () => {
      const loader = new CountingCache('value')

      const operation = new CachingOperation<string>([loader])
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
      const cache1 = new InMemoryCache<string>()
      const cache2 = new InMemoryCache<string>()
      const loader1 = new CountingCache(undefined)
      const loader2 = new CountingCache('value')

      const operation = new CachingOperation<string>([cache1, cache2, loader1, loader2])
      const valuePre = await operation.get('key')

      await operation.invalidateCacheFor('key')
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe(undefined)
      expect(loader2.counter).toBe(2)
    })

    it('correctly handles errors during invalidation', async () => {
      const cache1 = new InMemoryCache<string>()
      const cache2 = new ThrowingCache()
      const loader1 = new CountingCache(undefined)
      const loader2 = new CountingCache('value')

      const operation = new CachingOperation<string>([cache1, cache2, loader1, loader2])
      const valuePre = await operation.get('key')

      await operation.invalidateCacheFor('key')
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe(undefined)
      expect(loader2.counter).toBe(2)
    })
  })

  describe('invalidateCache', () => {
    it('correctly invalidates cache', async () => {
      const cache1 = new InMemoryCache<string>()
      const cache2 = new InMemoryCache<string>()
      const loader1 = new CountingCache(undefined)
      const loader2 = new CountingCache('value')

      const operation = new CachingOperation<string>([cache1, cache2, loader1, loader2])
      const valuePre = await operation.get('key')

      await operation.invalidateCache()
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe(undefined)
      expect(loader2.counter).toBe(2)
    })

    it('correctly handles errors during invalidation', async () => {
      const cache1 = new InMemoryCache<string>()
      const cache2 = new ThrowingCache()
      const loader1 = new CountingCache(undefined)
      const loader2 = new CountingCache('value')

      const operation = new CachingOperation<string>([cache1, cache2, loader1, loader2])
      const valuePre = await operation.get('key')

      await operation.invalidateCache()
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe(undefined)
      expect(loader2.counter).toBe(2)
    })
  })
})
