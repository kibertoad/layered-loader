import { User } from './types/testTypes'
import { GroupedLoadingOperation } from '../lib/GroupedLoadingOperation'
import { CountingGroupedLoader } from './fakes/CountingGroupedLoader'
import { setTimeout } from 'timers/promises'
import { RedisCache } from '../lib/redis'
import Redis from 'ioredis'
import { redisOptions } from './fakes/TestRedisConfig'

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

describe('GroupedLoadingOperation Async Refresh', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  describe('background async refresh', () => {
    let redis: Redis
    beforeEach(async () => {
      redis = new Redis(redisOptions)
      await redis.flushall()
    })

    afterEach(async () => {
      await setTimeout(10)
      await redis.disconnect()
    })

    it('triggers async background refresh when threshold is set and reached', async () => {
      const loader = new CountingGroupedLoader(userValues)
      const asyncCache = new RedisCache<User>(redis, {
        ttlInMsecs: 150,
        json: true,
        ttlLeftBeforeRefreshInMsecs: 75,
      })

      const operation = new GroupedLoadingOperation<User>({
        asyncCache,
        loaders: [loader],
      })

      // @ts-ignore
      expect(await operation.asyncCache.get(user1.userId, user1.companyId)).toBeUndefined()
      expect(loader.counter).toBe(0)
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      expect(loader.counter).toBe(1)
      // @ts-ignore
      const expirationTimePre = await operation.asyncCache.getExpirationTimeFromGroup(user1.userId, user1.companyId)

      await setTimeout(100)
      expect(loader.counter).toBe(1)
      // kick off the refresh
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      await setTimeout(5)
      expect(loader.counter).toBe(2)
      // @ts-ignore
      const expirationTimePost = await operation.asyncCache.getExpirationTimeFromGroup(user1.userId, user1.companyId)

      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      await Promise.resolve()
      expect(loader.counter).toBe(2)
      expect(expirationTimePre).toBeDefined()
      expect(expirationTimePost).toBeDefined()
      expect(expirationTimePost! > expirationTimePre!).toBe(true)
    })

    it('async background refresh errors do not crash app', async () => {
      const loader = new CountingGroupedLoader(userValues)
      const asyncCache = new RedisCache<User>(redis, {
        ttlInMsecs: 150,
        json: true,
        ttlLeftBeforeRefreshInMsecs: 75,
      })

      const operation = new GroupedLoadingOperation<User>({
        asyncCache,
        loaders: [loader],
        throwIfUnresolved: true,
      })

      // @ts-ignore
      expect(await operation.asyncCache.get(user1.userId, user1.companyId)).toBeUndefined()
      expect(loader.counter).toBe(0)
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
      expect(loader.counter).toBe(1)

      await setTimeout(100)
      expect(loader.counter).toBe(1)
      loader.groupValues = userValuesUndefined
      // kick off the refresh
      expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)

      await setTimeout(100)
      await expect(() => operation.get(user1.userId, user1.companyId)).rejects.toThrow(
        /Failed to resolve value for key "1", group "1"/
      )
      await Promise.resolve()
      expect(loader.counter).toBe(3)
    })
  })
})
