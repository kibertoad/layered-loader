import { setTimeout } from 'node:timers/promises'
import { beforeEach, describe, expect, it, vitest } from 'vitest'
import type { CacheKeyResolver } from '../lib/AbstractCache'
import { GroupLoader } from '../lib/GroupLoader'
import type { InMemoryGroupCacheConfiguration } from '../lib/memory/InMemoryGroupCache'
import { CountingGroupedLoader } from './fakes/CountingGroupedLoader'
import type { DummyLoaderManyParams, DummyLoaderParams } from './fakes/DummyDataSourceWithParams'
import { DummyGroupNotificationConsumer } from './fakes/DummyGroupNotificationConsumer'
import { DummyGroupNotificationConsumerMultiplexer } from './fakes/DummyGroupNotificationConsumerMultiplexer'
import { DummyGroupNotificationPublisher } from './fakes/DummyGroupNotificationPublisher'
import { DummyGroupedCache } from './fakes/DummyGroupedCache'
import { DummyGroupedDataSourceWithParams } from './fakes/DummyGroupedDataSourceWithParams'
import { DummyGroupedLoader } from './fakes/DummyGroupedLoader'
import { TemporaryThrowingGroupedLoader } from './fakes/TemporaryThrowingGroupedLoader'
import { ThrowingGroupedCache } from './fakes/ThrowingGroupedCache'
import { ThrowingGroupedLoader } from './fakes/ThrowingGroupedLoader'
import type { User } from './types/testTypes'

const IN_MEMORY_CACHE_CONFIG = {
  cacheId: 'dummy',
  ttlInMsecs: 9999999,
} satisfies InMemoryGroupCacheConfiguration

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

const newUser: User = { userId: 'dummy', companyId: 'dummy' }

const userValuesUndefined = {
  [user1.companyId]: {},
  [user3.companyId]: {},
}

const idResolver: CacheKeyResolver<User> = (value) => {
  return value.userId
}

describe('GroupLoader Main', () => {
  beforeEach(() => {
    vitest.resetAllMocks()
  })

  describe('notificationConsumer', () => {
    it('Handles simple notification consumer', async () => {
      const notificationConsumer = new DummyGroupNotificationConsumer('a')

      const operation = new GroupLoader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyGroupedCache(userValues),
        notificationConsumer,
      })

      await operation.getAsyncOnly(user1.userId, user1.companyId)
      const resultPre = operation.getInMemoryOnly(user1.userId, user1.companyId)
      notificationConsumer.setForGroup(user1.userId, newUser, user1.companyId)
      const resultPost = operation.getInMemoryOnly(user1.userId, user1.companyId)

      expect(resultPre).toEqual(user1)
      expect(resultPost).toEqual(newUser)
    })

    it('Handles simple notification publisher', async () => {
      const notificationConsumer = new DummyGroupNotificationConsumer('a')
      const notificationPublisher = new DummyGroupNotificationPublisher(notificationConsumer)

      const operation = new GroupLoader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyGroupedCache(userValues),
        notificationConsumer,
        notificationPublisher,
      })

      await operation.getAsyncOnly(user1.userId, user1.companyId)
      const resultPre = operation.getInMemoryOnly(user1.userId, user1.companyId)
      await notificationPublisher.setForGroup(user1.userId, newUser, user1.companyId)
      const resultPost = operation.getInMemoryOnly(user1.userId, user1.companyId)

      expect(resultPre).toEqual(user1)
      expect(resultPost).toEqual(newUser)
    })

    it('Propagates invalidation event to remote cache', async () => {
      const notificationConsumer1 = new DummyGroupNotificationConsumer('a')
      const notificationConsumer2 = new DummyGroupNotificationConsumer('b')
      const notificationMultiplexer = new DummyGroupNotificationConsumerMultiplexer([
        notificationConsumer1,
        notificationConsumer2,
      ])
      const notificationPublisher1 = new DummyGroupNotificationPublisher(notificationMultiplexer)
      const notificationPublisher2 = new DummyGroupNotificationPublisher(notificationMultiplexer)

      const operation = new GroupLoader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyGroupedCache(userValues),
        notificationConsumer: notificationConsumer1,
        notificationPublisher: notificationPublisher1,
      })

      const operation2 = new GroupLoader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyGroupedCache(userValues),
        notificationConsumer: notificationConsumer2,
        notificationPublisher: notificationPublisher2,
      })

      await operation.getAsyncOnly(user1.userId, user1.companyId)
      await operation2.getAsyncOnly(user1.userId, user1.companyId)
      const resultPre1 = operation.getInMemoryOnly(user1.userId, user1.companyId)
      const resultPre2 = operation2.getInMemoryOnly(user1.userId, user1.companyId)
      await operation.invalidateCacheFor(user1.userId, user1.companyId)
      const resultPost1 = operation.getInMemoryOnly(user1.userId, user1.companyId)
      const resultPost2 = operation2.getInMemoryOnly(user1.userId, user1.companyId)

      expect(resultPre1).toEqual(user1)
      expect(resultPre2).toEqual(user1)

      expect(resultPost1).toBeUndefined()
      expect(resultPost2).toBeUndefined()
    })

    it('Propagates complete invalidation event to remote cache', async () => {
      const notificationConsumer1 = new DummyGroupNotificationConsumer('a')
      const notificationConsumer2 = new DummyGroupNotificationConsumer('b')
      const notificationMultiplexer = new DummyGroupNotificationConsumerMultiplexer([
        notificationConsumer1,
        notificationConsumer2,
      ])
      const notificationPublisher1 = new DummyGroupNotificationPublisher(notificationMultiplexer)
      const notificationPublisher2 = new DummyGroupNotificationPublisher(notificationMultiplexer)

      const operation = new GroupLoader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyGroupedCache(userValues),
        notificationConsumer: notificationConsumer1,
        notificationPublisher: notificationPublisher1,
      })

      const operation2 = new GroupLoader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyGroupedCache(userValues),
        notificationConsumer: notificationConsumer2,
        notificationPublisher: notificationPublisher2,
      })

      await operation.getAsyncOnly(user1.userId, user1.companyId)
      await operation2.getAsyncOnly(user1.userId, user1.companyId)
      const resultPre1 = operation.getInMemoryOnly(user1.userId, user1.companyId)
      const resultPre2 = operation2.getInMemoryOnly(user1.userId, user1.companyId)
      await operation.invalidateCache()
      const resultPost1 = operation.getInMemoryOnly(user1.userId, user1.companyId)
      const resultPost2 = operation2.getInMemoryOnly(user1.userId, user1.companyId)

      expect(resultPre1).toEqual(user1)
      expect(resultPre2).toEqual(user1)

      expect(resultPost1).toBeUndefined()
      expect(resultPost2).toBeUndefined()
    })

    it('Propagates delete group event to remote cache', async () => {
      const notificationConsumer1 = new DummyGroupNotificationConsumer('a')
      const notificationConsumer2 = new DummyGroupNotificationConsumer('b')
      const notificationMultiplexer = new DummyGroupNotificationConsumerMultiplexer([
        notificationConsumer1,
        notificationConsumer2,
      ])
      const notificationPublisher1 = new DummyGroupNotificationPublisher(notificationMultiplexer)
      const notificationPublisher2 = new DummyGroupNotificationPublisher(notificationMultiplexer)

      const operation = new GroupLoader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyGroupedCache(userValues),
        notificationConsumer: notificationConsumer1,
        notificationPublisher: notificationPublisher1,
      })

      const operation2 = new GroupLoader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyGroupedCache(userValues),
        notificationConsumer: notificationConsumer2,
        notificationPublisher: notificationPublisher2,
      })

      await operation.getAsyncOnly(user1.userId, user1.companyId)
      await operation2.getAsyncOnly(user1.userId, user1.companyId)
      const resultPre1 = operation.getInMemoryOnly(user1.userId, user1.companyId)
      const resultPre2 = operation2.getInMemoryOnly(user1.userId, user1.companyId)
      await operation.invalidateCacheForGroup(user1.companyId)
      const resultPost1 = operation.getInMemoryOnly(user1.userId, user1.companyId)
      const resultPost2 = operation2.getInMemoryOnly(user1.userId, user1.companyId)

      expect(resultPre1).toEqual(user1)
      expect(resultPre2).toEqual(user1)

      expect(resultPost1).toBeUndefined()
      expect(resultPost2).toBeUndefined()
    })

    it('Closes notification consumer and publisher', async () => {
      const notificationConsumer = new DummyGroupNotificationConsumer('a')
      const notificationPublisher = new DummyGroupNotificationPublisher(notificationConsumer)

      const operation = new GroupLoader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyGroupedCache(userValues),
        notificationConsumer,
        notificationPublisher,
      })

      await operation.close()
      expect(notificationConsumer.closed).toBe(true)
      expect(notificationPublisher.closed).toBe(true)
    })

    it('Throws an error when resetting target cache', async () => {
      const notificationConsumer = new DummyGroupNotificationConsumer('a')

      new GroupLoader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyGroupedCache(userValues),
        notificationConsumer,
      })

      expect(() => {
        // @ts-expect-error this is for a test
        notificationConsumer.setTargetCache(null)
      }).toThrow(/Cannot modify already set target cache/)
    })

    it('Throws an error when inmemory cache is disabled', async () => {
      const notificationConsumer = new DummyGroupNotificationConsumer('a')

      expect(() => {
        new GroupLoader({
          asyncCache: new DummyGroupedCache(userValues),
          notificationConsumer,
        })
      }).toThrow(/Cannot set notificationConsumer when InMemoryCache is disabled/)
    })
  })

  describe('getInMemoryOnly', () => {
    it('returns undefined when no inmemory cache is configured', () => {
      const operation = new GroupLoader({})

      const result = operation.getInMemoryOnly('value', user1.companyId)

      expect(result).toBeUndefined()
    })

    it('returns undefined when no value is cached', () => {
      const operation = new GroupLoader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      })

      const result = operation.getInMemoryOnly('value', user1.companyId)

      expect(result).toBeUndefined()
    })

    it('returns cached value', async () => {
      const operation = new GroupLoader({
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

      const operation = new GroupLoader<User>({
        inMemoryCache: {
          cacheId: 'dummy',
          ttlInMsecs: 150,
          ttlLeftBeforeRefreshInMsecs: 75,
        },
        dataSources: [loader],
      })
      expect(operation.getInMemoryOnly(user1.userId, user1.companyId)).toBeUndefined()
      expect(loader.counter).toBe(0)
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      expect(loader.counter).toBe(1)
      // @ts-ignore
      const expirationTimePre = operation.inMemoryCache.getExpirationTimeFromGroup(
        user1.userId,
        user1.companyId,
      )

      await setTimeout(100)
      expect(loader.counter).toBe(1)
      // kick off the refresh
      expect(operation.getInMemoryOnly(user1.userId, user1.companyId)).toEqual(user1)
      await setTimeout(1)
      expect(loader.counter).toBe(2)
      await Promise.resolve()
      // @ts-ignore
      const expirationTimePost = operation.inMemoryCache.getExpirationTimeFromGroup(
        user1.userId,
        user1.companyId,
      )

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
      const operation = new GroupLoader({})

      const result = await operation.get(user1.userId, user1.companyId)

      expect(result).toBeUndefined()
    })

    it('throws when fails to resolve value, with flag and no loaders', async () => {
      const operation = new GroupLoader({
        throwIfUnresolved: true,
      })

      await expect(() => {
        return operation.get(user1.userId, user1.companyId)
      }).rejects.toThrow(`Failed to resolve value for key "1", group "1"`)
    })

    it('throws when fails to resolve value and flag is set', async () => {
      const operation = new GroupLoader({
        throwIfUnresolved: true,
        dataSources: [new DummyGroupedLoader(userValuesUndefined)],
      })

      await expect(() => {
        return operation.get(user1.userId, user1.companyId)
      }).rejects.toThrow(`Failed to resolve value for key "1", group "1"`)
    })

    it('does not throw when flag is set, but loader can resolve the value', async () => {
      const cache = new DummyGroupedCache(userValuesUndefined)
      const loader = new DummyGroupedLoader(userValues)

      const operation = new GroupLoader({
        asyncCache: cache,
        dataSources: [loader],
        throwIfUnresolved: true,
      })

      const value = await operation.get(user1.userId, user1.companyId)
      expect(value).toEqual(user1)
    })

    it('logs error during load', async () => {
      const consoleSpy = vitest.spyOn(console, 'error')
      const operation = new GroupLoader({
        dataSources: [new ThrowingGroupedLoader()],
        throwIfLoadError: true,
      })

      await expect(() => {
        return operation.get(user1.userId, user1.companyId)
      }).rejects.toThrow(/Error has occurred/)
      expect(consoleSpy).toHaveBeenCalledTimes(1)
    })

    it('resets loading operation after value was not found previously', async () => {
      const loader = new DummyGroupedLoader(userValuesUndefined)
      const operation = new GroupLoader({ dataSources: [loader] })

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
      const operation = new GroupLoader({ dataSources: [loader] })

      await expect(() => {
        return operation.get(user1.userId, user1.companyId)
      }).rejects.toThrow(/Error has occurred/)

      loader.isThrowing = false
      const value = await operation.get(user1.userId, user1.companyId)
      expect(value).toEqual(user1)
    })

    it('correctly handles error during cache update', async () => {
      const consoleSpy = vitest.spyOn(console, 'error')
      const operation = new GroupLoader({
        asyncCache: new ThrowingGroupedCache(),
        dataSources: [new DummyGroupedLoader(userValues)],
      })

      const value = await operation.get(user1.userId, user1.companyId)

      expect(value).toEqual(user1)
      expect(consoleSpy).toHaveBeenCalledTimes(2)
    })

    it('returns value when resolved via single loader', async () => {
      const operation = new GroupLoader<User>({ inMemoryCache: IN_MEMORY_CACHE_CONFIG })
      // @ts-ignore
      operation.inMemoryCache.setForGroup(user1.userId, user1, user1.companyId)

      const result = await operation.get(user1.userId, user1.companyId)

      expect(result).toEqual(user1)
    })

    it('returns value when resolved via multiple loaders', async () => {
      const asyncCache = new DummyGroupedCache(userValuesUndefined)

      const operation = new GroupLoader<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: asyncCache,
      })
      await asyncCache.setForGroup(user1.userId, user1, user1.companyId)

      const result = await operation.get(user1.userId, user1.companyId)

      expect(result).toEqual(user1)
    })

    it('updates upper level cache when resolving value downstream', async () => {
      const cache2 = new DummyGroupedCache(userValuesUndefined)
      const operation = new GroupLoader<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [
          new DummyGroupedLoader(userValuesUndefined),
          new DummyGroupedLoader(userValues),
        ],
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
      const operation = new GroupLoader<User, DummyLoaderParams>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [new DummyGroupedDataSourceWithParams(userValues)],
        cacheKeyFromLoadParamsResolver: (value) => value.key,
      })
      // @ts-ignore
      const cache1 = operation.inMemoryCache

      const valuePre = await cache1.getFromGroup(user1.userId, user1.companyId)
      await operation.get({ prefix: 'pre', key: user1.userId, suffix: 'post' }, user1.companyId)
      const valuePost = await cache1.getFromGroup(user1.userId, user1.companyId)
      const valuePost2 = await cache2.getFromGroup(user1.userId, user1.companyId)

      expect(valuePre).toBeUndefined()
      expect(valuePost).toEqual({ companyId: '1', parametrized: 'prepost', userId: '1' })
      expect(valuePost2).toEqual({ companyId: '1', parametrized: 'prepost', userId: '1' })
    })

    it('correctly reuses value from cache', async () => {
      const cache2 = new DummyGroupedCache(userValuesUndefined)
      const loader1 = new CountingGroupedLoader(userValuesUndefined)
      const loader2 = new CountingGroupedLoader(userValues)

      const operation = new GroupLoader<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [loader1, loader2],
      })

      const valuePre = await operation.get(user1.userId, user1.companyId)
      const valuePost = await operation.get(user1.userId, user1.companyId)

      expect(valuePre).toEqual(user1)
      expect(valuePost).toEqual(user1)
      expect(loader2.counter).toBe(1)
    })

    it('batches identical retrievals together', async () => {
      const loader = new CountingGroupedLoader(userValues)

      const operation = new GroupLoader<User>({ dataSources: [loader] })
      const valuePromise = operation.get(user1.userId, user1.companyId)
      const valuePromise2 = operation.get(user1.userId, user1.companyId)

      const value = await valuePromise
      const value2 = await valuePromise2

      expect(value).toEqual(user1)
      expect(value2).toEqual(user1)
      expect(loader.counter).toBe(1)
    })
  })

  describe('getMany', () => {
    it('returns empty array when fails to resolve value', async () => {
      const operation = new GroupLoader<User>({
        cacheKeyFromValueResolver: idResolver,
      })

      const result = await operation.getMany([user1.userId], user1.companyId)

      expect(result).toEqual([])
    })

    it('throws when fails to resolve value, with flag and no loaders', async () => {
      const operation = new GroupLoader<User>({
        throwIfUnresolved: true,
        cacheKeyFromValueResolver: idResolver,
      })

      await expect(() => {
        return operation.getMany([user1.userId], user1.companyId)
      }).rejects.toThrow('Failed to resolve value for some of the keys (group 1): 1')
    })

    it('throws when fails to resolve value and flag is set', async () => {
      const operation = new GroupLoader<User>({
        throwIfUnresolved: true,
        dataSources: [new DummyGroupedLoader(userValuesUndefined)],
        cacheKeyFromValueResolver: idResolver,
      })

      await expect(() => {
        return operation.getMany([user1.userId], user1.companyId)
      }).rejects.toThrow('Failed to resolve value for some of the keys (group 1): 1')
    })

    it('does not throw when fails with an error and flag is set to false', async () => {
      const operation = new GroupLoader<User>({
        throwIfLoadError: false,
        dataSources: [new ThrowingGroupedLoader()],
        cacheKeyFromValueResolver: idResolver,
      })

      const result = await operation.getMany([user1.userId], user1.companyId)

      expect(result).toEqual([])
    })

    it('does not throw when flag is set, but loader can resolve the value', async () => {
      const cache = new DummyGroupedCache(userValuesUndefined)
      const loader = new DummyGroupedLoader(userValues)

      const operation = new GroupLoader<User>({
        asyncCache: cache,
        dataSources: [loader],
        throwIfUnresolved: true,
        cacheKeyFromValueResolver: idResolver,
      })

      const value = await operation.getMany([user1.userId], user1.companyId)
      expect(value).toEqual([user1])
    })

    it('logs error during load', async () => {
      const consoleSpy = vitest.spyOn(console, 'error')
      const operation = new GroupLoader<User>({
        dataSources: [new ThrowingGroupedLoader()],
        throwIfLoadError: true,
        cacheKeyFromValueResolver: idResolver,
      })

      await expect(() => {
        return operation.getMany([user1.userId], user1.companyId)
      }).rejects.toThrow(/Error has occurred/)

      expect(consoleSpy).toHaveBeenCalledTimes(1)
    })

    it('resets loading operation after value was not found previously', async () => {
      const loader = new DummyGroupedLoader(userValuesUndefined)
      const operation = new GroupLoader<User>({
        dataSources: [loader],
        cacheKeyFromValueResolver: idResolver,
      })

      const value = await operation.getMany([user1.userId], user1.companyId)
      expect(value).toEqual([])

      loader.groupValues = null
      const value2 = await operation.getMany([user1.userId], user1.companyId)
      expect(value2).toEqual([])

      loader.groupValues = userValues
      const value3 = await operation.getMany([user1.userId], user1.companyId)
      expect(value3).toEqual([user1])
    })

    it('resets loading operation after error during load', async () => {
      const loader = new TemporaryThrowingGroupedLoader(userValues)
      const operation = new GroupLoader({
        dataSources: [loader],
        cacheKeyFromValueResolver: idResolver,
      })

      await expect(() => {
        return operation.getMany([user1.userId], user1.companyId)
      }).rejects.toThrow(/Error has occurred/)

      loader.isThrowing = false
      const value = await operation.getMany([user1.userId], user1.companyId)
      expect(value).toEqual([user1])
    })

    it('correctly handles error during cache update', async () => {
      const consoleSpy = vitest.spyOn(console, 'error')
      const operation = new GroupLoader<User>({
        asyncCache: new ThrowingGroupedCache(),
        dataSources: [new DummyGroupedLoader(userValues)],
        cacheKeyFromValueResolver: idResolver,
      })

      const value = await operation.getMany([user1.userId], user1.companyId)

      expect(value).toEqual([user1])
      expect(consoleSpy).toHaveBeenCalledTimes(2)
    })

    it('returns value when resolved via single loader', async () => {
      const operation = new GroupLoader<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        cacheKeyFromValueResolver: idResolver,
      })
      // @ts-ignore
      operation.inMemoryCache.setForGroup(user1.userId, user1, user1.companyId)

      const result = await operation.getMany([user1.userId], user1.companyId)

      expect(result).toEqual([user1])
    })

    it('returns value when resolved via multiple loaders', async () => {
      const asyncCache = new DummyGroupedCache(userValuesUndefined)

      const operation = new GroupLoader<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: asyncCache,
        cacheKeyFromValueResolver: idResolver,
      })
      await asyncCache.setForGroup(user1.userId, user1, user1.companyId)

      const result = await operation.getMany([user1.userId], user1.companyId)

      expect(result).toEqual([user1])
    })

    it('updates upper level cache when resolving value downstream', async () => {
      const cache2 = new DummyGroupedCache(userValuesUndefined)
      const operation = new GroupLoader<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [
          new DummyGroupedLoader(userValuesUndefined),
          new DummyGroupedLoader(userValues),
        ],
        cacheKeyFromValueResolver: idResolver,
      })
      // @ts-ignore
      const cache1 = operation.inMemoryCache

      const valuePre = cache1.getFromGroup(user1.userId, user1.companyId)
      await operation.getMany([user1.userId], user1.companyId)
      const valuePost = cache1.getFromGroup(user1.userId, user1.companyId)
      const valuePost2 = await cache2.getFromGroup(user1.userId, user1.companyId)

      expect(valuePre).toBeUndefined()
      expect(valuePost).toEqual(user1)
      expect(valuePost2).toEqual(user1)
    })

    it('passes loadParams to the loader', async () => {
      const cache2 = new DummyGroupedCache(userValuesUndefined)
      const operation = new GroupLoader<User, DummyLoaderParams, DummyLoaderManyParams>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [new DummyGroupedDataSourceWithParams(userValues)],
        cacheKeyFromValueResolver: idResolver,
      })
      // @ts-ignore
      const cache1 = operation.inMemoryCache

      const valuePre = await cache1.getFromGroup(user1.userId, user1.companyId)
      await operation.getMany([user1.userId], user1.companyId, {
        prefix: 'pre',
        suffix: 'post',
      })
      const valuePost = await cache1.getFromGroup(user1.userId, user1.companyId)
      const valuePost2 = await cache2.getFromGroup(user1.userId, user1.companyId)

      expect(valuePre).toBeUndefined()
      expect(valuePost).toEqual({ companyId: '1', parametrized: 'prepost', userId: '1' })
      expect(valuePost2).toEqual({ companyId: '1', parametrized: 'prepost', userId: '1' })
    })

    it('correctly reuses value from cache', async () => {
      const cache2 = new DummyGroupedCache(userValuesUndefined)
      const loader1 = new CountingGroupedLoader(userValuesUndefined)
      const loader2 = new CountingGroupedLoader(userValues)

      const operation = new GroupLoader<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [loader1, loader2],
        cacheKeyFromValueResolver: idResolver,
      })

      const valuePre = await operation.getMany([user1.userId], user1.companyId)
      const valuePost = await operation.getMany([user1.userId], user1.companyId)

      expect(valuePre).toEqual([user1])
      expect(valuePost).toEqual([user1])
      expect(loader2.counter).toBe(1)
    })

    it('does not batch identical retrievals', async () => {
      const loader = new CountingGroupedLoader(userValues)

      const operation = new GroupLoader<User>({
        dataSources: [loader],
        cacheKeyFromValueResolver: idResolver,
      })
      const valuePromise = operation.getMany([user1.userId], user1.companyId)
      const valuePromise2 = operation.getMany([user1.userId], user1.companyId)

      const value = await valuePromise
      const value2 = await valuePromise2

      expect(value).toEqual([user1])
      expect(value2).toEqual([user1])
      expect(loader.counter).toBe(2)
    })

    it('deduplicates keys in getMany with mixed cache layers', async () => {
      const loader = new GroupLoader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyGroupedCache(userValues),
        dataSources: [new CountingGroupedLoader(userValues)],
        cacheKeyFromValueResolver: (user: User) => user.userId,
      })

      const duplicatedKeys = ['1', '1', '2', '2', '1']

      const result = await loader.getMany(duplicatedKeys, '1')
      expect(result).toEqual([user1, user2])
    })
  })

  describe('invalidateCacheFor', () => {
    it('invalidates cache', async () => {
      const cache2 = new DummyGroupedCache(userValuesUndefined)
      const loader1 = new CountingGroupedLoader(userValuesUndefined)
      const loader2 = new CountingGroupedLoader(userValues)

      const operation = new GroupLoader<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [loader1, loader2],
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

      const operation = new GroupLoader<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [loader1, loader2],
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

      const operation = new GroupLoader<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [loader1, loader2],
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

      const operation = new GroupLoader<User>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [loader1, loader2],
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
