import { InMemoryCacheConfiguration } from '../lib/memory/InMemoryCache'
import { User } from './types/testTypes'
import { GroupedLoadingOperation } from '../lib/GroupedLoadingOperation'
import { DummyGroupedCache } from './fakes/DummyGroupedCache'
import { ThrowingGroupedLoader } from './fakes/ThrowingGroupedLoader'
import { DummyGroupedLoader } from './fakes/DummyGroupedLoader'
import { TemporaryThrowingGroupedLoader } from './fakes/TemporaryThrowingGroupedLoader'
import { ThrowingGroupedCache } from './fakes/ThrowingGroupedCache'
import { CountingGroupedLoader } from './fakes/CountingGroupedLoader'
import { DummyLoaderParams } from './fakes/DummyLoaderWithParams'
import { DummyGroupedLoaderWithParams } from './fakes/DummyGroupedLoaderWithParams'
import { setTimeout } from 'timers/promises'
import { RedisCache } from '../lib/redis'
import Redis from 'ioredis'
import { redisOptions } from './fakes/TestRedisConfig'

const IN_MEMORY_CACHE_CONFIG = { ttlInMsecs: 9999999 } satisfies InMemoryCacheConfiguration

const user1: User = {
  companyId: '1',
  userId: '1',
}

const user2: User = {
  companyId: '1',
  userId: '2',
}

const user3: User = {
  companyId: '2',
  userId: '3',
}

const userValues = {
  [user1.companyId]: {
    [user1.userId]: user1,
    [user2.userId]: user2,
  },
  [user3.companyId]: {
    [user3.userId]: user3,
  },
}

const userValuesUndefined = {
  [user1.companyId]: {},
  [user3.companyId]: {},
}

describe('GroupedLoadingOperation Main', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  describe('getInMemoryOnly', () => {
    it('returns undefined when no inmemory cache is configured', () => {
      const operation = new GroupedLoadingOperation({})

      const result = operation.getInMemoryOnly('value', user1.companyId)

      expect(result).toBeUndefined()
    })

    it('returns undefined when no value is cached', () => {
      const operation = new GroupedLoadingOperation({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      })

      const result = operation.getInMemoryOnly('value', user1.companyId)

      expect(result).toBeUndefined()
    })

    it('returns cached value', async () => {
      const operation = new GroupedLoadingOperation({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyGroupedCache(userValues),
      })

      const resultPre = operation.getInMemoryOnly(user1.userId, user1.companyId)
      await operation.getAsyncOnly(user1.userId, user1.companyId)
      const resultPost = operation.getInMemoryOnly(user1.userId, user1.companyId)

      expect(resultPre).toBeUndefined()
      expect(resultPost).toEqual(user1)
    })

    it('triggers background refresh when threshold is set and reached', async () => {
      const loader = new CountingGroupedLoader(userValues)

      const operation = new GroupedLoadingOperation<User>({
        inMemoryCache: {
          ttlInMsecs: 150,
          ttlLeftBeforeRefreshInMsecs: 75,
        },
        loaders: [loader],
      })
      expect(operation.getInMemoryOnly(user1.userId, user1.companyId)).toBeUndefined()
      expect(loader.counter).toBe(0)
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      expect(loader.counter).toBe(1)
      // @ts-ignore
      const expirationTimePre = operation.inMemoryCache.getExpirationTimeFromGroup(user1.userId, user1.companyId)

      await setTimeout(100)
      expect(loader.counter).toBe(1)
      // kick off the refresh
      expect(operation.getInMemoryOnly(user1.userId, user1.companyId)).toEqual(user1)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      expect(loader.counter).toBe(2)
      await Promise.resolve()
      // @ts-ignore
      const expirationTimePost = operation.inMemoryCache.getExpirationTimeFromGroup(user1.userId, user1.companyId)

      expect(operation.getInMemoryOnly(user1.userId, user1.companyId)).toEqual(user1)
      await Promise.resolve()
      expect(loader.counter).toBe(2)
      expect(expirationTimePre).toBeDefined()
      expect(expirationTimePost).toBeDefined()
      expect(expirationTimePost! > expirationTimePre!).toBe(true)
    })
  })

  describe('get', () => {
    it('returns undefined when fails to resolve value', async () => {
      const operation = new GroupedLoadingOperation({})

      const result = await operation.get(user1.userId, user1.companyId)

      expect(result).toBeUndefined()
    })

    it('throws when fails to resolve value, with flag and no loaders', async () => {
      const operation = new GroupedLoadingOperation({
        throwIfUnresolved: true,
      })

      await expect(() => {
        return operation.get(user1.userId, user1.companyId)
      }).rejects.toThrow(`Failed to resolve value for key "1", group "1"`)
    })

    it('throws when fails to resolve value and flag is set', async () => {
      const operation = new GroupedLoadingOperation({
        throwIfUnresolved: true,
        loaders: [new DummyGroupedLoader(userValuesUndefined)],
      })

      await expect(() => {
        return operation.get(user1.userId, user1.companyId)
      }).rejects.toThrow(`Failed to resolve value for key "1", group "1"`)
    })

    it('does not throw when flag is set, but loader can resolve the value', async () => {
      const cache = new DummyGroupedCache(userValuesUndefined)
      const loader = new DummyGroupedLoader(userValues)

      const operation = new GroupedLoadingOperation({
        asyncCache: cache,
        loaders: [loader],
        throwIfUnresolved: true,
      })

      const value = await operation.get(user1.userId, user1.companyId)
      expect(value).toEqual(user1)
    })

    it('logs error during load', async () => {
      const consoleSpy = jest.spyOn(console, 'error')
      const operation = new GroupedLoadingOperation({ loaders: [new ThrowingGroupedLoader()], throwIfLoadError: true })

      await expect(() => {
        return operation.get(user1.userId, user1.companyId)
      }).rejects.toThrow(/Error has occurred/)
      expect(consoleSpy).toHaveBeenCalledTimes(1)
    })

    it('resets loading operation after value was not found previously', async () => {
      const loader = new DummyGroupedLoader(userValuesUndefined)
      const operation = new GroupedLoadingOperation({ loaders: [loader] })

      const value = await operation.get(user1.userId, user1.companyId)
      expect(value).toBeNull()

      loader.groupValues = null
      const value2 = await operation.get(user1.userId, user1.companyId)
      expect(value2).toBeNull()

      loader.groupValues = userValues
      const value3 = await operation.get(user1.userId, user1.companyId)
      expect(value3).toEqual(user1)
    })

    it('resets loading operation after error during load', async () => {
      const loader = new TemporaryThrowingGroupedLoader(userValues)
      const operation = new GroupedLoadingOperation({ loaders: [loader] })

      await expect(() => {
        return operation.get(user1.userId, user1.companyId)
      }).rejects.toThrow(/Error has occurred/)

      loader.isThrowing = false
      const value = await operation.get(user1.userId, user1.companyId)
      expect(value).toEqual(user1)
    })

    it('correctly handles error during cache update', async () => {
      const consoleSpy = jest.spyOn(console, 'error')
      const operation = new GroupedLoadingOperation({
        asyncCache: new ThrowingGroupedCache(),
        loaders: [new DummyGroupedLoader(userValues)],
      })

      const value = await operation.get(user1.userId, user1.companyId)

      expect(value).toEqual(user1)
      expect(consoleSpy).toHaveBeenCalledTimes(2)
    })

    it('returns value when resolved via single loader', async () => {
      const operation = new GroupedLoadingOperation<User>({ inMemoryCache: IN_MEMORY_CACHE_CONFIG })
      // @ts-ignore
      operation.inMemoryCache.setForGroup(user1.userId, user1, user1.companyId)

      const result = await operation.get(user1.userId, user1.companyId)

      expect(result).toEqual(user1)
    })

    it('returns value when resolved via multiple loaders', async () => {
      const asyncCache = new DummyGroupedCache(userValuesUndefined)

      const operation = new GroupedLoadingOperation<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: asyncCache,
      })
      await asyncCache.setForGroup(user1.userId, user1, user1.companyId)

      const result = await operation.get(user1.userId, user1.companyId)

      expect(result).toEqual(user1)
    })

    it('updates upper level cache when resolving value downstream', async () => {
      const cache2 = new DummyGroupedCache(userValuesUndefined)
      const operation = new GroupedLoadingOperation<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        loaders: [new DummyGroupedLoader(userValuesUndefined), new DummyGroupedLoader(userValues)],
      })
      // @ts-ignore
      const cache1 = operation.inMemoryCache

      const valuePre = cache1.getFromGroup(user1.userId, user1.companyId)
      await operation.get(user1.userId, user1.companyId)
      const valuePost = cache1.getFromGroup(user1.userId, user1.companyId)
      const valuePost2 = await cache2.getFromGroup(user1.userId, user1.companyId)

      expect(valuePre).toBeUndefined()
      expect(valuePost).toEqual(user1)
      expect(valuePost2).toEqual(user1)
    })

    it('passes loadParams to the loader', async () => {
      const cache2 = new DummyGroupedCache(userValuesUndefined)
      const operation = new GroupedLoadingOperation<User, DummyLoaderParams>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        loaders: [new DummyGroupedLoaderWithParams(userValues)],
      })
      // @ts-ignore
      const cache1 = operation.inMemoryCache

      const valuePre = await cache1.getFromGroup(user1.userId, user1.companyId)
      await operation.get(user1.userId, user1.companyId, { prefix: 'pre', suffix: 'post' })
      const valuePost = await cache1.getFromGroup(user1.userId, user1.companyId)
      const valuePost2 = await cache2.getFromGroup(user1.userId, user1.companyId)

      expect(valuePre).toBe(undefined)
      expect(valuePost).toEqual({ companyId: '1', parametrized: 'prepost', userId: '1' })
      expect(valuePost2).toEqual({ companyId: '1', parametrized: 'prepost', userId: '1' })
    })

    it('correctly reuses value from cache', async () => {
      const cache2 = new DummyGroupedCache(userValuesUndefined)
      const loader1 = new CountingGroupedLoader(userValuesUndefined)
      const loader2 = new CountingGroupedLoader(userValues)

      const operation = new GroupedLoadingOperation<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        loaders: [loader1, loader2],
      })

      const valuePre = await operation.get(user1.userId, user1.companyId)
      const valuePost = await operation.get(user1.userId, user1.companyId)

      expect(valuePre).toEqual(user1)
      expect(valuePost).toEqual(user1)
      expect(loader2.counter).toBe(1)
    })

    it('batches identical retrievals together', async () => {
      const loader = new CountingGroupedLoader(userValues)

      const operation = new GroupedLoadingOperation<User>({ loaders: [loader] })
      const valuePromise = operation.get(user1.userId, user1.companyId)
      const valuePromise2 = operation.get(user1.userId, user1.companyId)

      const value = await valuePromise
      const value2 = await valuePromise2

      expect(value).toEqual(user1)
      expect(value2).toEqual(user1)
      expect(loader.counter).toBe(1)
    })
  })

  describe('invalidateCacheFor', () => {
    it('invalidates cache', async () => {
      const cache2 = new DummyGroupedCache(userValuesUndefined)
      const loader1 = new CountingGroupedLoader(userValuesUndefined)
      const loader2 = new CountingGroupedLoader(userValues)

      const operation = new GroupedLoadingOperation<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        loaders: [loader1, loader2],
      })

      const valuePre = await operation.get(user1.userId, user1.companyId)
      await operation.invalidateCacheFor(user1.userId, user1.companyId)
      const valuePost = await operation.get(user1.userId, user1.companyId)

      expect(valuePre).toEqual(user1)
      expect(valuePost).toEqual(user1)
      expect(loader2.counter).toBe(2)
    })

    it('correctly handles errors during invalidation', async () => {
      const cache2 = new ThrowingGroupedCache()
      const loader1 = new CountingGroupedLoader(userValuesUndefined)
      const loader2 = new CountingGroupedLoader(userValues)

      const operation = new GroupedLoadingOperation<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        loaders: [loader1, loader2],
      })

      const valuePre = await operation.get(user1.userId, user1.companyId)

      await operation.invalidateCacheFor(user1.userId, user1.companyId)
      const valuePost = await operation.get(user1.userId, user1.companyId)

      expect(valuePre).toEqual(user1)
      expect(valuePost).toEqual(user1)
      expect(loader2.counter).toBe(2)
    })
  })

  describe('invalidateCache', () => {
    it('correctly invalidates cache', async () => {
      const cache2 = new DummyGroupedCache(userValuesUndefined)
      const loader1 = new CountingGroupedLoader(userValuesUndefined)
      const loader2 = new CountingGroupedLoader(userValues)

      const operation = new GroupedLoadingOperation<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        loaders: [loader1, loader2],
      })

      const valuePre = await operation.get(user1.userId, user1.companyId)

      await operation.invalidateCache()
      const valuePost = await operation.get(user1.userId, user1.companyId)

      expect(valuePre).toEqual(user1)
      expect(valuePost).toEqual(user1)
      expect(loader2.counter).toBe(2)
    })

    it('handles errors during invalidation', async () => {
      const cache2 = new ThrowingGroupedCache()
      const loader1 = new CountingGroupedLoader(userValuesUndefined)
      const loader2 = new CountingGroupedLoader(userValues)

      const operation = new GroupedLoadingOperation<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        loaders: [loader1, loader2],
      })

      const valuePre = await operation.get(user1.userId, user1.companyId)

      await operation.invalidateCache()
      const valuePost = await operation.get(user1.userId, user1.companyId)

      expect(valuePre).toEqual(user1)
      expect(valuePost).toEqual(user1)
      expect(loader2.counter).toBe(2)
    })
  })
})
