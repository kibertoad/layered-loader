import Redis from 'ioredis'
import { RedisCache } from '../lib/redis/RedisCache'
import { redisOptions } from './utils/TestRedisConfig'

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
        timeout: 9999999,
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

  describe('deleteGroup', () => {
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
