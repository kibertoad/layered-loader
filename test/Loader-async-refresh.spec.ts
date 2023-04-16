import { setTimeout } from 'timers/promises'
import { Loader } from '../lib/Loader'
import { CountingLoader } from './fakes/CountingLoader'
import { RedisCache } from '../lib/redis'
import Redis from 'ioredis'
import { redisOptions } from './fakes/TestRedisConfig'
import { DelayedCountingLoader } from './fakes/DelayedCountingLoader'

describe('Loader Async', () => {
  let redis: Redis
  beforeEach(async () => {
    jest.resetAllMocks()
    redis = new Redis(redisOptions)
    await redis.flushall()
  })

  afterEach(async () => {
    await setTimeout(10)
    await redis.disconnect()
  })

  describe('get', () => {
    it('triggers async background refresh when threshold is set and reached', async () => {
      const loader = new CountingLoader('value')
      const asyncCache = new RedisCache<string>(redis, {
        ttlInMsecs: 150,
        ttlLeftBeforeRefreshInMsecs: 75,
      })

      const operation = new Loader<string>({
        asyncCache,
        loaders: [loader],
      })
      // @ts-ignore
      expect(await operation.asyncCache.get('key')).toBeUndefined()
      expect(loader.counter).toBe(0)
      expect(await operation.get('key')).toBe('value')
      expect(loader.counter).toBe(1)
      // @ts-ignore
      const expirationTimePre = await operation.asyncCache.getExpirationTime('key')

      await setTimeout(100)
      expect(loader.counter).toBe(1)
      // kick off the refresh
      expect(await operation.get('key')).toBe('value')
      await setTimeout(1)
      await Promise.resolve()
      expect(loader.counter).toBe(2)
      // @ts-ignore
      const expirationTimePost = await operation.asyncCache.getExpirationTime('key')

      expect(await operation.get('key')).toBe('value')
      await Promise.resolve()
      expect(loader.counter).toBe(2)
      expect(expirationTimePre).toBeDefined()
      expect(expirationTimePost).toBeDefined()
      expect(expirationTimePost! > expirationTimePre!).toBe(true)
    })

    it('only triggers single async background refresh when threshold is set and reached', async () => {
      const loader = new DelayedCountingLoader('value')
      const asyncCache = new RedisCache<string>(redis, {
        ttlInMsecs: 9999,
        json: true,
        ttlLeftBeforeRefreshInMsecs: 9925,
        ttlCacheTtl: 2000,
      })

      const operation = new Loader<string>({
        asyncCache,
        loaders: [loader],
      })

      // @ts-ignore
      expect(await operation.asyncCache.get('key')).toBeUndefined()
      expect(loader.counter).toBe(0)
      const promise0 = operation.get('key')
      await setTimeout(2)
      await loader.finishLoading()
      expect(await promise0).toEqual('value')
      expect(loader.counter).toBe(1)
      // @ts-ignore
      const expirationTimePre = await operation.asyncCache.getExpirationTime('key')

      expect(await operation.get('key')).toEqual('value')
      await setTimeout(90)
      expect(loader.counter).toBe(1)
      // kick off the refresh
      const promise2 = await operation.get('key')
      void operation.get('key')
      void operation.get('key')
      await setTimeout(10)
      await loader.finishLoading()
      expect(await promise2).toEqual('value')

      expect(loader.counter).toBe(2)
      await setTimeout(5)
      // @ts-ignore
      const expirationTimePost = await operation.asyncCache.getExpirationTime('key')

      expect(await operation.get('key')).toEqual('value')
      await Promise.resolve()
      expect(loader.counter).toBe(2)
      expect(expirationTimePre).toBeDefined()
      expect(expirationTimePost).toBeDefined()
      expect(expirationTimePost! > expirationTimePre!).toBe(true)
    })

    it('async background refresh errors do not crash app', async () => {
      const loader = new CountingLoader('value')
      const asyncCache = new RedisCache<string>(redis, {
        ttlInMsecs: 150,
        ttlLeftBeforeRefreshInMsecs: 75,
      })

      const operation = new Loader<string>({
        asyncCache,
        loaders: [loader],
        throwIfUnresolved: true,
      })
      // @ts-ignore
      expect(await operation.asyncCache.get('key')).toBeUndefined()
      expect(loader.counter).toBe(0)
      expect(await operation.get('key')).toBe('value')
      expect(loader.counter).toBe(1)

      await setTimeout(100)
      expect(loader.counter).toBe(1)
      loader.value = undefined
      // kick off the refresh
      expect(await operation.get('key')).toBe('value')
      await setTimeout(100)
      await expect(() => operation.get('key')).rejects.toThrow(/Failed to resolve value for key "key"/)
      await Promise.resolve()
      expect(loader.counter).toBe(3)
    })
  })
})