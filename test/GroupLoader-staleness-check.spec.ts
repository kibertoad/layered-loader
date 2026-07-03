import { setTimeout } from 'node:timers/promises'
import Redis from 'ioredis'
import { afterEach, beforeEach, describe, expect, it, vitest } from 'vitest'
import { GroupLoader } from '../lib/GroupLoader'
import { RedisGroupCache } from '../lib/redis/RedisGroupCache'
import { CountingGroupedLoader } from './fakes/CountingGroupedLoader'
import { DummyGroupedCache } from './fakes/DummyGroupedCache'
import { redisOptions } from './fakes/TestRedisConfig'
import type { User } from './types/testTypes'

const user1: User = {
  companyId: '1',
  userId: '1',
}

const user3: User = {
  companyId: '2',
  userId: '3',
}

const userValues = {
  [user1.companyId]: {
    [user1.userId]: user1,
  },
  [user3.companyId]: {
    [user3.userId]: user3,
  },
}

describe('GroupLoader staleness check', () => {
  let redis: Redis
  beforeEach(async () => {
    vitest.resetAllMocks()
    redis = new Redis(redisOptions)
    await redis.flushall()
  })

  afterEach(async () => {
    await setTimeout(10)
    await redis.disconnect()
  })

  describe('get', () => {
    it('bumps ttl without refetching when entry is still current', async () => {
      const loader = new CountingGroupedLoader(userValues)
      const asyncCache = new RedisGroupCache<User>(redis, {
        ttlInMsecs: 150,
        json: true,
        ttlLeftBeforeRefreshInMsecs: 75,
      })
      const isEntryStillCurrentFn = vitest.fn(async () => true)

      const operation = new GroupLoader<User>({
        asyncCache,
        dataSources: [loader],
        isEntryStillCurrentFn,
      })
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      expect(loader.counter).toBe(1)
      // @ts-expect-error
      const expirationTimePre = await operation.asyncCache.getExpirationTimeFromGroup(
        user1.userId,
        user1.companyId,
      )

      await setTimeout(100)
      // kick off the staleness check
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      // Wait for the background check to actually run.
      for (
        let attempt = 0;
        attempt < 20 && isEntryStillCurrentFn.mock.calls.length < 1;
        attempt++
      ) {
        await setTimeout(10)
      }
      expect(isEntryStillCurrentFn).toHaveBeenCalledWith(user1, user1.userId, user1.companyId)
      await setTimeout(10)

      // no full refetch happened
      expect(loader.counter).toBe(1)
      // @ts-expect-error
      const expirationTimePost = await operation.asyncCache.getExpirationTimeFromGroup(
        user1.userId,
        user1.companyId,
      )
      expect(expirationTimePre).toBeDefined()
      expect(expirationTimePost).toBeDefined()
      expect(expirationTimePost! > expirationTimePre!).toBe(true)
    })

    it('does not touch other groups when bumping ttl', async () => {
      const loader = new CountingGroupedLoader(userValues)
      const asyncCache = new RedisGroupCache<User>(redis, {
        ttlInMsecs: 500,
        json: true,
        ttlLeftBeforeRefreshInMsecs: 75,
      })
      const isEntryStillCurrentFn = vitest.fn(async () => true)

      const operation = new GroupLoader<User>({
        asyncCache,
        dataSources: [loader],
        isEntryStillCurrentFn,
      })
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      expect(await operation.get(user3.userId, user3.companyId)).toEqual(user3)
      // @ts-expect-error
      const otherGroupExpirationPre = await operation.asyncCache.getExpirationTimeFromGroup(
        user3.userId,
        user3.companyId,
      )

      await setTimeout(450)
      // kick off the check + bump for group 1 only
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      for (
        let attempt = 0;
        attempt < 20 && isEntryStillCurrentFn.mock.calls.length < 1;
        attempt++
      ) {
        await setTimeout(10)
      }
      await setTimeout(10)

      // @ts-expect-error
      const otherGroupExpirationPost = await operation.asyncCache.getExpirationTimeFromGroup(
        user3.userId,
        user3.companyId,
      )
      expect(otherGroupExpirationPost).toBeDefined()
      expect(otherGroupExpirationPost! <= otherGroupExpirationPre!).toBe(true)
    })

    it('propagates the freshly refetched value into the in-memory group cache when stale', async () => {
      const loader = new CountingGroupedLoader(userValues)
      const asyncCache = new RedisGroupCache<User>(redis, {
        ttlInMsecs: 300,
        json: true,
        ttlLeftBeforeRefreshInMsecs: 150,
      })

      const operation = new GroupLoader<User>({
        inMemoryCache: {
          cacheId: 'group-staleness-two-layer',
          ttlInMsecs: 300,
          ttlLeftBeforeRefreshInMsecs: 150,
        },
        asyncCache,
        dataSources: [loader],
        isEntryStillCurrentFn: async () => false,
      })
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      expect(loader.counter).toBe(1)

      // the data source now returns an updated entity
      const updatedUser1: User = { ...user1, parametrized: 'updated' }
      loader.groupValues![user1.companyId][user1.userId] = updatedUser1

      await setTimeout(200)
      // kick off the check, which reports the entry as stale and triggers a refetch
      await operation.get(user1.userId, user1.companyId)
      for (let attempt = 0; attempt < 20 && loader.counter < 2; attempt++) {
        await setTimeout(10)
      }
      expect(loader.counter).toBe(2)

      // the in-memory layer must now serve the fresh value, not the stale one
      // @ts-expect-error accessing protected member for assertion
      expect(operation.inMemoryCache.getFromGroup(user1.userId, user1.companyId)).toEqual(
        updatedUser1,
      )
    })

    it('falls back to full background refetch when entry is stale', async () => {
      const loader = new CountingGroupedLoader(userValues)
      const asyncCache = new RedisGroupCache<User>(redis, {
        ttlInMsecs: 150,
        json: true,
        ttlLeftBeforeRefreshInMsecs: 75,
      })
      const isEntryStillCurrentFn = vitest.fn(async () => false)

      const operation = new GroupLoader<User>({
        asyncCache,
        dataSources: [loader],
        isEntryStillCurrentFn,
      })
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      expect(loader.counter).toBe(1)

      await setTimeout(100)
      // kick off the check, which reports the entry as stale
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      // Wait for the background refresh to actually call the data source.
      for (let attempt = 0; attempt < 20 && loader.counter < 2; attempt++) {
        await setTimeout(10)
      }
      expect(loader.counter).toBe(2)
    })

    it('treats a throwing staleness check as stale and refetches', async () => {
      const loader = new CountingGroupedLoader(userValues)
      const asyncCache = new RedisGroupCache<User>(redis, {
        ttlInMsecs: 150,
        json: true,
        ttlLeftBeforeRefreshInMsecs: 75,
      })
      const loadErrorHandler = vitest.fn()

      const operation = new GroupLoader<User>({
        asyncCache,
        dataSources: [loader],
        isEntryStillCurrentFn: async () => {
          throw new Error('check failed')
        },
        loadErrorHandler,
      })
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      expect(loader.counter).toBe(1)

      await setTimeout(100)
      // kick off the check, which throws
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      // Wait for the fallback background refresh to actually call the data source.
      for (let attempt = 0; attempt < 20 && loader.counter < 2; attempt++) {
        await setTimeout(10)
      }
      expect(loader.counter).toBe(2)
      expect(loadErrorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'check failed' }),
        user1.userId,
        expect.objectContaining({ name: 'isEntryStillCurrentFn' }),
        expect.anything(),
      )
    })

    it('falls back to full refetch when the ttl bump fails', async () => {
      const loader = new CountingGroupedLoader(userValues)
      const asyncCache = new RedisGroupCache<User>(redis, {
        ttlInMsecs: 150,
        json: true,
        ttlLeftBeforeRefreshInMsecs: 75,
      })
      vitest.spyOn(asyncCache, 'resetTtlFromGroup').mockRejectedValue(new Error('connection lost'))
      const cacheUpdateErrorHandler = vitest.fn()

      const operation = new GroupLoader<User>({
        asyncCache,
        dataSources: [loader],
        isEntryStillCurrentFn: async () => true,
        cacheUpdateErrorHandler,
      })
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      expect(loader.counter).toBe(1)

      await setTimeout(100)
      // kick off the check; ttl bump rejects
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      // Wait for the fallback background refresh to actually call the data source.
      for (let attempt = 0; attempt < 20 && loader.counter < 2; attempt++) {
        await setTimeout(10)
      }
      expect(loader.counter).toBe(2)
      expect(cacheUpdateErrorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'connection lost' }),
        user1.userId,
        asyncCache,
        expect.anything(),
      )
    })

    it('refetches when the group was invalidated between the read and the ttl bump', async () => {
      const loader = new CountingGroupedLoader(userValues)
      const asyncCache = new RedisGroupCache<User>(redis, {
        ttlInMsecs: 150,
        json: true,
        ttlLeftBeforeRefreshInMsecs: 75,
      })

      const operation = new GroupLoader<User>({
        asyncCache,
        dataSources: [loader],
        isEntryStillCurrentFn: async () => {
          // simulate the group being invalidated while the check is in flight
          await asyncCache.deleteGroup(user1.companyId)
          return true
        },
      })
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      expect(loader.counter).toBe(1)

      await setTimeout(100)
      // kick off the check; ttl bump fails because the group index was rotated
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      // Wait for the fallback background refresh to actually call the data source.
      for (let attempt = 0; attempt < 20 && loader.counter < 2; attempt++) {
        await setTimeout(10)
      }
      expect(loader.counter).toBe(2)
    })

    it('only runs a single staleness check for concurrent gets', async () => {
      const loader = new CountingGroupedLoader(userValues)
      const asyncCache = new RedisGroupCache<User>(redis, {
        ttlInMsecs: 9999,
        json: true,
        ttlLeftBeforeRefreshInMsecs: 9925,
        ttlCacheTtl: 2000,
      })

      let finishCheck: (isCurrent: boolean) => void
      const checkPromise = new Promise<boolean>((resolve) => {
        finishCheck = resolve
      })
      const isEntryStillCurrentFn = vitest.fn(() => checkPromise)

      const operation = new GroupLoader<User>({
        asyncCache,
        dataSources: [loader],
        isEntryStillCurrentFn,
      })
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      expect(loader.counter).toBe(1)

      await setTimeout(90)
      // kick off the check and keep it hanging while more gets come in
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      void operation.get(user1.userId, user1.companyId)
      void operation.get(user1.userId, user1.companyId)
      await setTimeout(10)
      finishCheck!(true)
      await setTimeout(10)

      expect(isEntryStillCurrentFn).toHaveBeenCalledTimes(1)
      expect(loader.counter).toBe(1)

      // @ts-expect-error
      const groupRefreshFlags: Map<string, Set<string>> = operation.groupRefreshFlags
      // The empty Set for the group should have been cleaned up
      expect(groupRefreshFlags.has(user1.companyId)).toBe(false)
    })
  })

  describe('constructor', () => {
    it('throws when isEntryStillCurrentFn is set without an asyncCache', () => {
      expect(
        () =>
          new GroupLoader<User>({
            dataSources: [new CountingGroupedLoader(userValues)],
            isEntryStillCurrentFn: async () => true,
          }),
      ).toThrow(/isEntryStillCurrentFn requires an asyncCache/)
    })

    it('throws when the asyncCache does not support resetTtlFromGroup', () => {
      expect(
        () =>
          new GroupLoader<User>({
            asyncCache: new DummyGroupedCache(userValues),
            dataSources: [new CountingGroupedLoader(userValues)],
            isEntryStillCurrentFn: async () => true,
          }),
      ).toThrow(/does not support resetTtlFromGroup/)
    })

    it('throws when the asyncCache has no ttlLeftBeforeRefreshInMsecs configured', () => {
      expect(
        () =>
          new GroupLoader<User>({
            asyncCache: new RedisGroupCache<User>(redis, { ttlInMsecs: 150, json: true }),
            dataSources: [new CountingGroupedLoader(userValues)],
            isEntryStillCurrentFn: async () => true,
          }),
      ).toThrow(/ttlLeftBeforeRefreshInMsecs/)
    })
  })
})
