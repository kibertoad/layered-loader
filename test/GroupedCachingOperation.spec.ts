import { GroupedCachingOperation } from '../lib/GroupedCachingOperation'
import { ThrowingGroupedCache } from './utils/ThrowingGroupedCache'
import { User } from './utils/Types'
import { RedisCache } from '../lib/redis'
import Redis from 'ioredis'
import { redisOptions } from './utils/TestRedisConfig'
import { DummyGroupedCache } from './utils/DummyGroupedCache'
import { CountingGroupedCache } from './utils/CountingGroupedCache'

const redisCacheConfig = { json: true, ttlInMsecs: 99999, prefix: 'users' }

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

const userValuesNull = {
  [user1.companyId]: {
    [user1.userId]: null,
    [user2.userId]: null,
  },
  [user3.companyId]: {
    [user3.userId]: null,
  },
}

describe('GroupedCachingOperation', () => {
  let redis: Redis

  beforeEach(async () => {
    jest.resetAllMocks()
    redis = new Redis(redisOptions)
    await redis.flushall()
  })

  afterEach(async () => {
    await redis.disconnect()
  })

  describe('set', () => {
    it('handles error when trying to set a value', async () => {
      const operation = new GroupedCachingOperation<User>([
        new ThrowingGroupedCache(),
        new RedisCache(redis, { json: true, ttlInMsecs: 99999, prefix: 'users' }),
      ])

      await operation.set(user1.userId, user1, user1.companyId)

      const result = await operation.get('1', '1')
      expect(result).toEqual(user1)
    })
  })

  describe('get', () => {
    it('returns undefined when fails to resolve value', async () => {
      const operation = new GroupedCachingOperation([])

      const result = await operation.get('value', 'fakegroup')

      expect(result).toBe(undefined)
    })

    it('logs error during load', async () => {
      const consoleSpy = jest.spyOn(console, 'error')
      const operation = new GroupedCachingOperation([new ThrowingGroupedCache()])

      await expect(() => {
        return operation.get('value', 'fake group')
      }).rejects.toThrow(/Error has occurred/)
      expect(consoleSpy).toHaveBeenCalledTimes(1)
    })

    it('resets loading operation after value was not found previously', async () => {
      const cache = new DummyGroupedCache(userValuesUndefined)
      const operation = new GroupedCachingOperation([cache], {
        loadingOperationMemoryTtl: 999999,
      })

      const value = await operation.get(user1.userId, user1.companyId)
      expect(value).toBeUndefined()

      cache.groupValues = userValuesNull
      const value2 = await operation.get(user1.userId, user1.companyId)
      expect(value2).toBeNull()

      cache.groupValues = userValues
      const value3 = await operation.get(user1.userId, user1.companyId)
      expect(value3).toEqual({ companyId: '1', userId: '1' })
    })

    it('handles error during cache update', async () => {
      const consoleSpy = jest.spyOn(console, 'error')
      const operation = new GroupedCachingOperation([new ThrowingGroupedCache(), new DummyGroupedCache(userValues)])
      const value = await operation.get(user1.userId, user1.companyId)
      expect(value).toEqual(user1)
      expect(consoleSpy).toHaveBeenCalledTimes(2)
    })

    it('returns value when resolved via single loader', async () => {
      const cache = new RedisCache<User>(redis, redisCacheConfig)
      const operation = new GroupedCachingOperation<User>([cache])
      await cache.setForGroup(user1.userId, user1, user1.companyId)

      const result = await operation.get(user1.userId, user1.companyId)

      expect(result).toEqual(user1)
    })

    it('returns value when resolved via multiple loaders', async () => {
      const cache1 = new RedisCache<User>(redis, {
        ...redisCacheConfig,
        prefix: 'users1',
      })
      const cache2 = new RedisCache<User>(redis, {
        ...redisCacheConfig,
        prefix: 'users2',
      })

      const operation = new GroupedCachingOperation<User>([cache1, cache2])
      await cache2.setForGroup(user1.userId, user1, user1.companyId)

      const result = await operation.get(user1.userId, user1.companyId)

      expect(result).toEqual(user1)
    })

    it('updates upper level cache when resolving value downstream', async () => {
      const cache1 = new RedisCache<User>(redis, {
        ...redisCacheConfig,
        prefix: 'users1',
      })
      const cache2 = new RedisCache<User>(redis, {
        ...redisCacheConfig,
        prefix: 'users2',
      })

      const operation = new GroupedCachingOperation<User>([cache1, cache2])
      const valuePre = await cache1.getFromGroup(user1.userId, user1.companyId)
      await operation.set(user1.userId, user1, user1.companyId)
      const valuePost = await cache1.getFromGroup(user1.userId, user1.companyId)
      const valuePost2 = await cache2.getFromGroup(user1.userId, user1.companyId)

      expect(valuePre).toBeUndefined()
      expect(valuePost).toEqual(user1)
      expect(valuePost2).toEqual(user1)
    })

    it('correctly reuses value from cache', async () => {
      const cache1 = new RedisCache<User>(redis, {
        ...redisCacheConfig,
        prefix: 'users1',
      })
      const cache2 = new RedisCache<User>(redis, {
        ...redisCacheConfig,
        prefix: 'users2',
      })
      const loader1 = new CountingGroupedCache({})
      const loader2 = new CountingGroupedCache(userValues)

      const operation = new GroupedCachingOperation<User>([cache1, cache2, loader1, loader2])
      const valuePre = await operation.get(user1.userId, user1.companyId)
      const valuePost = await operation.get(user1.userId, user1.companyId)

      expect(valuePre).toEqual(user1)
      expect(valuePost).toEqual(user1)
      expect(loader2.counter).toBe(1)
    })

    it('batches identical retrievals together', async () => {
      const loader = new CountingGroupedCache(userValues)

      const operation = new GroupedCachingOperation<User>([loader])
      const valuePromise = operation.get(user1.userId, user1.companyId)
      const valuePromise2 = operation.get(user1.userId, user1.companyId)

      const value = await valuePromise
      const value2 = await valuePromise2

      expect(value).toEqual(user1)
      expect(value2).toEqual(user1)
      expect(loader.counter).toBe(1)
    })
  })

  describe('invalidateCacheForGroup', () => {
    it('invalidates cache', async () => {
      const cache1 = new RedisCache<User>(redis, {
        ...redisCacheConfig,
        separator: ':',
        prefix: 'users1',
      })
      const cache2 = new RedisCache<User>(redis, {
        ...redisCacheConfig,
        separator: ':',
        prefix: 'users2',
      })
      const loader1 = new CountingGroupedCache({})
      const loader2 = new CountingGroupedCache(userValues)

      const operation = new GroupedCachingOperation<User>([cache1, cache2, loader1, loader2])
      const valuePre = await operation.get(user1.userId, user1.companyId)
      const value2Pre = await operation.get(user3.userId, user3.companyId)

      await operation.invalidateCacheForGroup(user1.companyId)
      const valuePost = await operation.get(user1.userId, user1.companyId)
      const value2Post = await operation.get(user3.userId, user3.companyId)

      expect(loader2.counter).toBe(3)
      expect(valuePre).toEqual(user1)
      expect(valuePost).toBeUndefined()
      expect(value2Pre).toEqual(user3)
      expect(value2Post).toEqual(user3)
    })

    it('handles errors during invalidation', async () => {
      const cache1 = new RedisCache<User>(redis, {
        ...redisCacheConfig,
        separator: ':',
        prefix: 'users1',
      })
      const cache2 = new ThrowingGroupedCache()
      const loader1 = new CountingGroupedCache({})
      const loader2 = new CountingGroupedCache(userValues)

      const operation = new GroupedCachingOperation<User>([cache1, cache2, loader1, loader2])
      const valuePre = await operation.get(user1.userId, user1.companyId)

      await operation.invalidateCacheForGroup(user1.companyId)
      const valuePost = await operation.get(user1.userId, user1.companyId)

      expect(valuePre).toEqual(user1)
      expect(valuePost).toBeUndefined()
      expect(loader2.counter).toBe(2)
    })
  })

  describe('invalidateCache', () => {
    it('invalidates cache', async () => {
      const cache1 = new RedisCache<User>(redis, {
        ...redisCacheConfig,
        separator: ':',
        prefix: 'users1',
      })
      const cache2 = new RedisCache<User>(redis, {
        ...redisCacheConfig,
        separator: ':',
        prefix: 'users2',
      })
      const loader1 = new CountingGroupedCache({})
      const loader2 = new CountingGroupedCache(userValues)

      const operation = new GroupedCachingOperation<User>([cache1, cache2, loader1, loader2])
      const valuePre = await operation.get(user1.userId, user1.companyId)

      await operation.invalidateCache()
      const valuePost = await operation.get(user1.userId, user1.companyId)

      expect(valuePre).toEqual(user1)
      expect(valuePost).toBeUndefined()
      expect(loader2.counter).toBe(2)
    })

    it('handles errors during invalidation', async () => {
      const cache1 = new RedisCache<User>(redis, {
        ...redisCacheConfig,
        separator: ':',
        prefix: 'users1',
      })
      const cache2 = new ThrowingGroupedCache()
      const loader1 = new CountingGroupedCache({})
      const loader2 = new CountingGroupedCache(userValues)

      const operation = new GroupedCachingOperation<User>([cache1, cache2, loader1, loader2])
      const valuePre = await operation.get(user1.userId, user1.companyId)

      await operation.invalidateCache()
      const valuePost = await operation.get(user1.userId, user1.companyId)

      expect(valuePre).toEqual(user1)
      expect(valuePost).toBeUndefined()
      expect(loader2.counter).toBe(2)
    })
  })
})
