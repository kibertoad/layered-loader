import Redis from 'ioredis'
import { RedisCache } from '../lib/redis/RedisCache'
import { redisOptions } from './fakes/TestRedisConfig'

describe('RedisCache', () => {
  let redis: Redis
  beforeEach(async () => {
    redis = new Redis(redisOptions)
    await redis.flushall()
  })
  afterEach(async () => {
    await redis.disconnect()
  })

  describe('get', () => {
    it('retrieves value with timeout', async () => {
      const cache = new RedisCache(redis, {
        json: false,
        timeoutInMsecs: 9999999,
        prefix: 'cache',
        ttlInMsecs: undefined,
      })
      await cache.set('key', 'value')
      await cache.set('key2', 'value2')

      const value1 = await cache.get('key')
      const value2 = await cache.get('key2')

      expect(value1).toEqual('value')
      expect(value2).toEqual('value2')
    })
  })

  describe('getFromGroup', () => {
    it('returns undefined if there is no dynamic group key registered in redis', async () => {
      const cache = new RedisCache(redis)

      const result = await cache.getFromGroup('dummy', 'fake')

      expect(result).toBeUndefined()
    })
  })

  describe('clear', () => {
    it('clears values', async () => {
      const cache = new RedisCache(redis)
      await cache.set('key', 'value')
      await cache.set('key2', 'value2')

      await cache.clear()

      const value1 = await cache.get('key')
      const value2 = await cache.get('key2')

      expect(value1).toBeUndefined()
      expect(value2).toBeUndefined()
    })

    it('clears empty storage', async () => {
      const cache = new RedisCache(redis)
      await cache.clear()

      const value1 = await cache.get('key')

      expect(value1).toBeUndefined()
    })

    it('clears chunked values', async () => {
      const cache = new RedisCache(redis)
      for (let x = 0; x < 1500; x++) {
        await cache.set(`key${x.toString()}`, 'value')
      }
      const key = 'key5'
      const key2 = 'key1005'
      const value1Pre = await cache.get(key)
      const value2Pre = await cache.get(key2)
      expect(value1Pre).toBe('value')
      expect(value2Pre).toBe('value')

      await cache.clear()

      const value1 = await cache.get(key)
      const value2 = await cache.get(key2)

      expect(value1).toBeUndefined()
      expect(value2).toBeUndefined()
    })

    it('does not clear values from other caches', async () => {
      const cache = new RedisCache(redis, { prefix: 'c1' })
      const cache2 = new RedisCache(redis, { prefix: 'c2' })
      await cache.set('key', 'value')
      await cache.set('key2', 'value2')
      await cache2.set('key', 'value')
      await cache2.set('key2', 'value2')

      await cache.clear()

      const valuec1v1 = await cache.get('key')
      const valuec1v2 = await cache.get('key2')
      const valuec2v1 = await cache2.get('key')
      const valuec2v2 = await cache2.get('key2')

      expect(valuec1v1).toBeUndefined()
      expect(valuec1v2).toBeUndefined()
      expect(valuec2v1).toBe('value')
      expect(valuec2v2).toBe('value2')
    })
  })

  describe('delete', () => {
    it('deletes values', async () => {
      const cache = new RedisCache(redis)
      await cache.set('key', 'value')
      await cache.set('key2', 'value2')

      await cache.delete('key')

      const value1 = await cache.get('key')
      const value2 = await cache.get('key2')

      expect(value1).toBeUndefined()
      expect(value2).toBe('value2')
    })
  })

  describe('deleteFromGroup', () => {
    it('deletes value from group', async () => {
      const cache = new RedisCache(redis)
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
      const cache = new RedisCache(redis)
      await cache.deleteFromGroup('key', 'group1')

      const value1group1 = await cache.getFromGroup('key', 'group1')

      await expect(value1group1).toBeUndefined()
    })
  })

  describe('deleteGroup', () => {
    it('clears empty group', async () => {
      const cache = new RedisCache(redis)

      await cache.deleteGroup('group2')

      const value = await cache.getFromGroup('dummy', 'group2')
      expect(value).toBeUndefined()
    })

    it('deletes values matching the group pattern', async () => {
      const cache = new RedisCache(redis)

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
      const cache = new RedisCache(redis, {
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
      const cache = new RedisCache(redis)
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

  describe('set', () => {
    it('sets json values correctly', async () => {
      const cache = new RedisCache(redis, {
        json: true,
        prefix: 'cache',
      })
      await cache.set('key', { value: 'value' })
      await cache.set('key2', { value: 'value2' })

      const value1 = await cache.get('key')
      const value2 = await cache.get('key2')

      expect(value1).toEqual({ value: 'value' })
      expect(value2).toEqual({ value: 'value2' })
    })

    it('sets non-json boolean values correctly', async () => {
      const cache = new RedisCache(redis, {
        json: false,
        prefix: 'cache',
      })
      await cache.set('key', true)
      await cache.set('key2', false)

      const value1 = await cache.get('key')
      const value2 = await cache.get('key2')
      const value3 = await cache.get('key3')

      expect(value1).toEqual('true')
      expect(value2).toEqual('false')
      expect(value3).toEqual(undefined)
    })

    it('sets json boolean values correctly', async () => {
      const cache = new RedisCache(redis, {
        json: true,
        prefix: 'cache',
      })
      await cache.set('key', true)
      await cache.set('key2', false)

      const value1 = await cache.get('key')
      const value2 = await cache.get('key2')
      const value3 = await cache.get('key3')

      expect(value1).toEqual(true)
      expect(value2).toEqual(false)
      expect(value3).toEqual(undefined)
    })

    it('sets expiration correctly', async () => {
      const cache = new RedisCache(redis, {
        json: true,
        ttlInMsecs: 10000,
        prefix: 'cache:',
      })
      await cache.set('key', { value: 'value' })
      await cache.set('key2', { value: 'value2' })

      const value1 = await cache.get('key')
      const value2 = await cache.get('key2')

      expect(value1).toEqual({ value: 'value' })
      expect(value2).toEqual({ value: 'value2' })
    })
  })
})
