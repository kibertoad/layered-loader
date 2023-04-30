import Redis from 'ioredis'
import { RedisGroupCache } from '../../lib/redis/RedisGroupCache'
import { redisOptions } from '../fakes/TestRedisConfig'
import { setTimeout } from 'timers/promises'

const TTL_IN_MSECS = 999

describe('RedisGroupCache', () => {
  let redis: Redis
  beforeEach(async () => {
    redis = new Redis(redisOptions)
    await redis.flushall()
  })
  afterEach(async () => {
    await redis.disconnect()
  })

  describe('constructor', () => {
    it('throws an error if ttl cache ttl is set, but refresh is disabled', async () => {
      expect(() => {
        return new RedisGroupCache(redis, { ttlCacheTtl: 500 })
      }).toThrow(/ttlCacheTtl cannot be specified if ttlLeftBeforeRefreshInMsecs is not/)
    })

    it('allows setting ttl cache ttl with refresh', async () => {
      expect(() => {
        return new RedisGroupCache(redis, {
          ttlCacheTtl: 500,
          ttlCacheGroupSize: 100,
          ttlLeftBeforeRefreshInMsecs: 9999,
        })
      }).not.toThrow(/ttlCacheTtl cannot be specified if ttlLeftBeforeRefreshInMsecs is not/)
    })
  })

  describe('getExpirationTimeFromGroup', () => {
    it('returns undefined for non-existent entry', async () => {
      const cache = new RedisGroupCache(redis, { ttlInMsecs: TTL_IN_MSECS })

      const expiresAt = await cache.getExpirationTimeFromGroup('dummy', 'group')

      expect(expiresAt).toBeUndefined()
    })

    it('returns past time for expired entry', async () => {
      const cache = new RedisGroupCache(redis, {
        ttlInMsecs: 1,
      })
      await cache.setForGroup('key', 'value', 'group')
      await setTimeout(10)

      const expiresAt = await cache.getExpirationTimeFromGroup('key', 'group')
      expect(expiresAt).toBeUndefined()
    })

    it('returns expiration time for existing entry', async () => {
      const cache = new RedisGroupCache(redis, { ttlInMsecs: TTL_IN_MSECS })

      await cache.setForGroup('key', 'value', 'group')

      const expiresAt = await cache.getExpirationTimeFromGroup('key', 'group')

      // should be 0 if everything happens in the same msec, but typically slightly differs
      const timeDifference = expiresAt! - TTL_IN_MSECS - Date.now()
      expect(timeDifference < 10).toBe(true)
    })

    it('resets expiration time for reset entry', async () => {
      const cache = new RedisGroupCache(redis, { ttlInMsecs: TTL_IN_MSECS })
      await cache.setForGroup('key', 'value', 'group')
      await setTimeout(500)

      const expiresAtPre = await cache.getExpirationTimeFromGroup('key', 'group')
      const timeLeftPre = expiresAtPre! - Date.now()

      await cache.setForGroup('key', 'value', 'group')

      const expiresAtPost = await cache.getExpirationTimeFromGroup('key', 'group')
      const timeLeftPost = expiresAtPost! - Date.now()

      expect(timeLeftPre < 530).toBe(true)
      expect(timeLeftPre > 470).toBe(true)
      expect(timeLeftPost < 1030).toBe(true)
      expect(timeLeftPost > 970).toBe(true)
    })
  })

  describe('getFromGroup', () => {
    it('returns undefined if there is no dynamic group key registered in redis', async () => {
      const cache = new RedisGroupCache(redis)

      const result = await cache.getFromGroup('dummy', 'fake')

      expect(result).toBeUndefined()
    })
  })

  describe('setForGroup', () => {
    it('sets value after group has already expired', async () => {
      const cache = new RedisGroupCache(redis, {
        ttlInMsecs: 2,
        groupTtlInMsecs: 1,
      })
      await cache.setForGroup('key', 'value', 'group')
      await setTimeout(15)

      const preValue = await cache.getFromGroup('key', 'group')
      expect(preValue).toBeUndefined()

      await cache.setForGroup('key', 'value', 'group')
      const postValue = await cache.getFromGroup('key', 'group')
      expect(postValue).toBe('value')
    })
  })

  describe('clear', () => {
    it('clears values', async () => {
      const cache = new RedisGroupCache(redis)
      await cache.setForGroup('key', 'value', 'group')
      await cache.setForGroup('key2', 'value2', 'group')

      await cache.clear()

      const value1 = await cache.getFromGroup('key', 'group')
      const value2 = await cache.getFromGroup('key2', 'group')

      expect(value1).toBeUndefined()
      expect(value2).toBeUndefined()
    })

    it('clears empty storage', async () => {
      const cache = new RedisGroupCache(redis)
      await cache.clear()

      const value1 = await cache.getFromGroup('key', 'group')

      expect(value1).toBeUndefined()
    })

    it('clears chunked values', async () => {
      const cache = new RedisGroupCache(redis)
      for (let x = 0; x < 1500; x++) {
        await cache.setForGroup(`key${x.toString()}`, 'value', 'group')
      }
      const key = 'key5'
      const key2 = 'key1005'
      const value1Pre = await cache.getFromGroup(key, 'group')
      const value2Pre = await cache.getFromGroup(key2, 'group')
      expect(value1Pre).toBe('value')
      expect(value2Pre).toBe('value')

      await cache.clear()

      const value1 = await cache.getFromGroup(key, 'group')
      const value2 = await cache.getFromGroup(key2, 'group')

      expect(value1).toBeUndefined()
      expect(value2).toBeUndefined()
    })

    it('does not clear values from other caches', async () => {
      const cache = new RedisGroupCache(redis, { prefix: 'c1' })
      const cache2 = new RedisGroupCache(redis, { prefix: 'c2' })
      await cache.setForGroup('key', 'value', 'group')
      await cache.setForGroup('key2', 'value2', 'group')
      await cache2.setForGroup('key', 'value', 'group')
      await cache2.setForGroup('key2', 'value2', 'group')

      await cache.clear()

      const valuec1v1 = await cache.getFromGroup('key', 'group')
      const valuec1v2 = await cache.getFromGroup('key2', 'group')
      const valuec2v1 = await cache2.getFromGroup('key', 'group')
      const valuec2v2 = await cache2.getFromGroup('key2', 'group')

      expect(valuec1v1).toBeUndefined()
      expect(valuec1v2).toBeUndefined()
      expect(valuec2v1).toBe('value')
      expect(valuec2v2).toBe('value2')
    })
  })

  describe('deleteFromGroup', () => {
    it('deletes value from group', async () => {
      const cache = new RedisGroupCache(redis)
      await cache.setForGroup('key', 'value', 'group1')
      await cache.setForGroup('key2', 'value2', 'group1')
      await cache.setForGroup('key', 'value', 'group2')
      await cache.setForGroup('key2', 'value2', 'group2')

      await cache.deleteFromGroup('key', 'group1')

      const value1group1 = await cache.getFromGroup('key', 'group1')
      const value2group1 = await cache.getFromGroup('key2', 'group1')
      const value1group2 = await cache.getFromGroup('key', 'group2')
      const value2group2 = await cache.getFromGroup('key2', 'group2')

      await expect(value1group1).toBeUndefined()
      await expect(value2group1).toBe('value2')
      await expect(value1group2).toBe('value')
      await expect(value2group2).toBe('value2')
    })

    it('does not crash when no values present', async () => {
      const cache = new RedisGroupCache(redis)
      await cache.deleteFromGroup('key', 'group1')

      const value1group1 = await cache.getFromGroup('key', 'group1')

      await expect(value1group1).toBeUndefined()
    })
  })

  describe('deleteGroup', () => {
    it('clears empty group', async () => {
      const cache = new RedisGroupCache(redis)

      await cache.deleteGroup('group2')

      const value = await cache.getFromGroup('dummy', 'group2')
      expect(value).toBeUndefined()
    })

    it('deletes values matching the group pattern', async () => {
      const cache = new RedisGroupCache(redis)

      await cache.setForGroup('key', 'value', 'team1')
      await cache.setForGroup('key2', 'value2', 'team1')
      await cache.setForGroup('key', 'value', 'team2')
      await cache.setForGroup('key2', 'value2', 'team2')

      await cache.deleteGroup('team2')

      const value1t1 = await cache.getFromGroup('key', 'team1')
      const value2t1 = await cache.getFromGroup('key2', 'team1')
      const value1t2 = await cache.getFromGroup('key', 'team2')
      const value2t2 = await cache.getFromGroup('key2', 'team2')

      expect(value1t1).toBe('value')
      expect(value2t1).toBe('value2')
      expect(value1t2).toBeUndefined()
      expect(value2t2).toBeUndefined()
    })

    it('deletes values matching the group pattern without ttl', async () => {
      const cache = new RedisGroupCache(redis, {
        json: false,
        prefix: 'prefix',
        ttlInMsecs: undefined,
      })

      await cache.setForGroup('key', 'value', 'team1')
      await cache.setForGroup('key2', 'value2', 'team1')
      await cache.setForGroup('key', 'value', 'team2')
      await cache.setForGroup('key2', 'value2', 'team2')

      await cache.deleteGroup('team2')

      const value1t1 = await cache.getFromGroup('key', 'team1')
      const value2t1 = await cache.getFromGroup('key2', 'team1')
      const value1t2 = await cache.getFromGroup('key', 'team2')
      const value2t2 = await cache.getFromGroup('key2', 'team2')

      expect(value1t1).toBe('value')
      expect(value2t1).toBe('value2')
      expect(value1t2).toBeUndefined()
      expect(value2t2).toBeUndefined()
    })

    it('clears chunked values', async () => {
      const cache = new RedisGroupCache(redis)
      const group1 = 'group1'
      const group2 = 'group2'
      for (let x = 0; x < 1500; x++) {
        await cache.setForGroup(`key${x.toString()}`, 'value', group1)
        await cache.setForGroup(`key${x.toString()}`, 'value2', group2)
      }
      const key = 'key5'
      const key2 = 'key1005'
      const value1PreGroup1 = await cache.getFromGroup(key, group1)
      const value2PreGroup1 = await cache.getFromGroup(key2, group1)
      const value1PreGroup2 = await cache.getFromGroup(key, group2)
      const value2PreGroup2 = await cache.getFromGroup(key2, group2)
      expect(value1PreGroup1).toBe('value')
      expect(value2PreGroup1).toBe('value')
      expect(value1PreGroup2).toBe('value2')
      expect(value2PreGroup2).toBe('value2')

      await cache.deleteGroup(group2)

      const value1Group1 = await cache.getFromGroup(key, group1)
      const value2Group1 = await cache.getFromGroup(key2, group1)
      const value1Group2 = await cache.getFromGroup(key, group2)
      const value2Group2 = await cache.getFromGroup(key2, group2)
      expect(value1Group1).toBe('value')
      expect(value2Group1).toBe('value')
      expect(value1Group2).toBeUndefined()
      expect(value2Group2).toBeUndefined()
    })
  })
})
