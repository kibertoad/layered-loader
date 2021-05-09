import Redis from 'ioredis'
import { RedisCache } from '../lib/redis/RedisCache'

const redisOptions: Redis.RedisOptions = {
  host: 'localhost',
  port: 6379,
  password: 'sOmE_sEcUrE_pAsS',
}

describe('RedisCache', () => {
  let redis: Redis.Redis
  beforeEach(async () => {
    redis = new Redis(redisOptions)
  })
  afterEach(async () => {
    await redis.disconnect()
  })

  describe('clear', () => {
    it('clears values correctly', async () => {
      const cache = new RedisCache(redis)
      await cache.set('key', 'value')
      await cache.set('key2', 'value2')

      await cache.clear()

      const value1 = await cache.get('key')
      const value2 = await cache.get('key2')

      expect(value1).toBeUndefined()
      expect(value2).toBeUndefined()
    })
  })

  describe('delete', () => {
    it('deletes values correctly', async () => {
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

  describe('set', () => {
    it('sets json values correctly', async () => {
      const cache = new RedisCache(redis, {
        json: true,
      })
      await cache.set('key', { value: 'value' })
      await cache.set('key2', { value: 'value2' })

      const value1 = await cache.get('key')
      const value2 = await cache.get('key2')

      expect(value1).toEqual({ value: 'value' })
      expect(value2).toEqual({ value: 'value2' })
    })

    it('sets expiration correctly', async () => {
      const cache = new RedisCache(redis, {
        json: true,
        ttlInMsecs: 10000,
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
