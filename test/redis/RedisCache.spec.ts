import Redis from 'ioredis'
import { setTimeout } from 'timers/promises'
import { RedisCache } from '../../lib/redis/RedisCache'
import { redisOptions } from '../fakes/TestRedisConfig'

const TTL_IN_MSECS = 999

describe('RedisCache', () => {
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
        return new RedisCache(redis, { ttlCacheTtl: 500 })
      }).toThrow(/ttlCacheTtl cannot be specified if ttlLeftBeforeRefreshInMsecs is not/)
    })
  })

  describe('getExpirationTime', () => {
    it('returns undefined for non-existent entry', async () => {
      const cache = new RedisCache(redis, { ttlInMsecs: TTL_IN_MSECS })

      const expiresAt = await cache.getExpirationTime('dummy')

      expect(expiresAt).toBeUndefined()
    })

    it('returns past time for expired entry', async () => {
      const cache = new RedisCache(redis, {
        ttlInMsecs: 1,
      })
      await cache.set('key', 'value')
      await setTimeout(10)

      const expiresAt = await cache.getExpirationTime('key')
      expect(expiresAt).toBeUndefined()
    })

    it('returns expiration time for existing entry', async () => {
      const cache = new RedisCache(redis, { ttlInMsecs: TTL_IN_MSECS })
      cache.set('key', 'value')

      const expiresAt = await cache.getExpirationTime('key')

      // should be 0 if everything happens in the same msec, but typically slightly differs
      const timeDifference = expiresAt! - TTL_IN_MSECS - Date.now()
      expect(timeDifference < 10).toBe(true)
    })

    it('resets expiration time for reset entry', async () => {
      const cache = new RedisCache(redis, { ttlInMsecs: TTL_IN_MSECS })
      await cache.set('key', 'value')
      await setTimeout(500)

      const expiresAtPre = await cache.getExpirationTime('key')
      const timeLeftPre = expiresAtPre! - Date.now()

      await cache.set('key', 'value')

      const expiresAtPost = await cache.getExpirationTime('key')
      const timeLeftPost = expiresAtPost! - Date.now()

      expect(timeLeftPre < 530).toBe(true)
      expect(timeLeftPre > 470).toBe(true)
      expect(timeLeftPost < 1030).toBe(true)
      expect(timeLeftPost > 970).toBe(true)
    })
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

      expect(value1).toBe('value')
      expect(value2).toBe('value2')
    })
  })

  describe('getManyFromGroup', () => {
    it('returns unresolved keys', async () => {
      const cache = new RedisCache(redis)
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      const values = await cache.getMany(['key', 'key2'])
      expect(values).toEqual({
        unresolvedKeys: ['key'],
        resolvedValues: ['value2'],
      })
    })

    it('resolves multiple values', async () => {
      const cache = new RedisCache(redis)
      await cache.set('key', 'value')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      const values = await cache.getMany(['key', 'key2'])
      expect(values).toEqual({
        unresolvedKeys: [],
        resolvedValues: ['value', 'value2'],
      })
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

  describe('deleteMany', () => {
    it('deletes values', async () => {
      const cache = new RedisCache(redis)
      await cache.set('key', 'value')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      await cache.deleteMany(['key', 'key3'])

      const value1 = await cache.get('key')
      const value2 = await cache.get('key2')
      const value3 = await cache.get('key3')

      expect(value1).toBeUndefined()
      expect(value2).toBe('value2')
      expect(value3).toBeUndefined()
    })
  })

  describe('set', () => {
    it('defaults to infinite ttl', async () => {
      const cache = new RedisCache(redis, {
        ttlInMsecs: undefined,
      })
      await cache.set('key', 'value')

      const ttl = await cache.getExpirationTime('key')
      const value = await cache.get('key')

      expect(ttl).toBeUndefined()
      expect(value).toBe('value')
    })

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

      expect(value1).toBe('true')
      expect(value2).toBe('false')
      expect(value3).toBeUndefined()
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

      expect(value1).toBe(true)
      expect(value2).toBe(false)
      expect(value3).toBeUndefined()
    })

    it('sets expiration', async () => {
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

  describe('setMany', () => {
    it('stores several items without ttl', async () => {
      const cache = new RedisCache(redis, {
        ttlInMsecs: undefined,
      })
      await cache.setMany([
        {
          key: 'key',
          value: 'value',
        },
        {
          key: 'key2',
          value: 'value2',
        },
      ])

      const ttl = await cache.getExpirationTime('key')
      const value = await cache.get('key')
      const ttl2 = await cache.getExpirationTime('key2')
      const value2 = await cache.get('key2')

      expect(ttl).toBeUndefined()
      expect(value).toBe('value')
      expect(ttl2).toBeUndefined()
      expect(value2).toBe('value2')
    })

    it('stores several items with ttl', async () => {
      const cache = new RedisCache(redis, {
        ttlInMsecs: 9999,
      })
      await cache.setMany([
        {
          key: 'key',
          value: 'value',
        },
        {
          key: 'key2',
          value: 'value2',
        },
      ])

      const ttl = await cache.getExpirationTime('key')
      const value = await cache.get('key')
      const ttl2 = await cache.getExpirationTime('key2')
      const value2 = await cache.get('key2')

      expect(ttl).toEqual(expect.any(Number))
      expect(value).toBe('value')
      expect(ttl2).toEqual(expect.any(Number))
      expect(value2).toBe('value2')
    })

    it('stores several JSON items without ttl', async () => {
      const cache = new RedisCache(redis, {
        ttlInMsecs: undefined,
        json: true,
      })
      await cache.setMany([
        {
          key: 'key',
          value: {
            value: 'value',
          },
        },
        {
          key: 'key2',
          value: {
            value: 'value2',
          },
        },
      ])

      const ttl = await cache.getExpirationTime('key')
      const value = await cache.get('key')
      const ttl2 = await cache.getExpirationTime('key2')
      const value2 = await cache.get('key2')

      expect(ttl).toBeUndefined()
      expect(value).toEqual({ value: 'value' })
      expect(ttl2).toBeUndefined()
      expect(value2).toEqual({ value: 'value2' })
    })

    it('stores several JSON items with ttl', async () => {
      const cache = new RedisCache(redis, {
        ttlInMsecs: 9999,
        json: true,
      })
      await cache.setMany([
        {
          key: 'key',
          value: {
            value: 'value',
          },
        },
        {
          key: 'key2',
          value: {
            value: 'value2',
          },
        },
      ])

      const ttl = await cache.getExpirationTime('key')
      const value = await cache.get('key')
      const ttl2 = await cache.getExpirationTime('key2')
      const value2 = await cache.get('key2')

      expect(ttl).toEqual(expect.any(Number))
      expect(value).toEqual({ value: 'value' })
      expect(ttl2).toEqual(expect.any(Number))
      expect(value2).toEqual({ value: 'value2' })
    })
  })

  describe('close', () => {
    it('reset refresh ttl on close', async () => {
      const cache = new RedisCache(redis, {
        json: false,
        timeoutInMsecs: 9999999,
        prefix: 'cache',
        ttlInMsecs: undefined,
        ttlLeftBeforeRefreshInMsecs: 999,
      })

      await cache.close()

      expect(cache.ttlLeftBeforeRefreshInMsecs).toBe(0)
    })
  })
})
