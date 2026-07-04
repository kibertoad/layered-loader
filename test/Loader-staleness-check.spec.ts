import { setTimeout } from 'node:timers/promises'
import Redis from 'ioredis'
import { afterEach, beforeEach, describe, expect, it, vitest } from 'vitest'
import { Loader } from '../lib/Loader'
import { RedisCache } from '../lib/redis'
import { CountingDataSource } from './fakes/CountingDataSource'
import { DummyCache } from './fakes/DummyCache'
import { redisOptions } from './fakes/TestRedisConfig'

describe('Loader staleness check', () => {
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
      const loader = new CountingDataSource('value')
      const asyncCache = new RedisCache<string>(redis, {
        ttlInMsecs: 150,
        ttlLeftBeforeRefreshInMsecs: 75,
      })
      const isEntryStillCurrentFn = vitest.fn(async () => true)

      const operation = new Loader<string>({
        asyncCache,
        dataSources: [loader],
        isEntryStillCurrentFn,
      })
      expect(await operation.get('key')).toBe('value')
      expect(loader.counter).toBe(1)
      // @ts-expect-error
      const expirationTimePre = await operation.asyncCache.getExpirationTime('key')

      await setTimeout(100)
      // kick off the staleness check
      expect(await operation.get('key')).toBe('value')
      // Wait for the background check to actually run.
      for (
        let attempt = 0;
        attempt < 20 && isEntryStillCurrentFn.mock.calls.length < 1;
        attempt++
      ) {
        await setTimeout(10)
      }
      expect(isEntryStillCurrentFn).toHaveBeenCalledWith('value', 'key')
      await setTimeout(10)

      // no full refetch happened
      expect(loader.counter).toBe(1)
      // @ts-expect-error
      const expirationTimePost = await operation.asyncCache.getExpirationTime('key')
      expect(expirationTimePre).toBeDefined()
      expect(expirationTimePost).toBeDefined()
      expect(expirationTimePost! > expirationTimePre!).toBe(true)
    })

    it('falls back to full background refetch when entry is stale', async () => {
      const loader = new CountingDataSource('v1')
      const asyncCache = new RedisCache<string>(redis, {
        ttlInMsecs: 150,
        ttlLeftBeforeRefreshInMsecs: 75,
      })
      const isEntryStillCurrentFn = vitest.fn(async () => false)

      const operation = new Loader<string>({
        asyncCache,
        dataSources: [loader],
        isEntryStillCurrentFn,
      })
      expect(await operation.get('key')).toBe('v1')
      expect(loader.counter).toBe(1)

      loader.value = 'v2'
      await setTimeout(100)
      // kick off the check, which reports the entry as stale
      expect(await operation.get('key')).toBe('v1')
      // Wait for the background refresh to actually call the data source.
      for (let attempt = 0; attempt < 20 && loader.counter < 2; attempt++) {
        await setTimeout(10)
      }
      expect(loader.counter).toBe(2)
      // @ts-expect-error
      expect(await operation.asyncCache.get('key')).toBe('v2')
    })

    it('treats a throwing staleness check as stale and refetches', async () => {
      const loader = new CountingDataSource('value')
      const asyncCache = new RedisCache<string>(redis, {
        ttlInMsecs: 150,
        ttlLeftBeforeRefreshInMsecs: 75,
      })
      const loadErrorHandler = vitest.fn()

      const operation = new Loader<string>({
        asyncCache,
        dataSources: [loader],
        isEntryStillCurrentFn: async () => {
          throw new Error('check failed')
        },
        loadErrorHandler,
      })
      expect(await operation.get('key')).toBe('value')
      expect(loader.counter).toBe(1)

      await setTimeout(100)
      // kick off the check, which throws
      expect(await operation.get('key')).toBe('value')
      // Wait for the fallback background refresh to actually call the data source.
      for (let attempt = 0; attempt < 20 && loader.counter < 2; attempt++) {
        await setTimeout(10)
      }
      expect(loader.counter).toBe(2)
      expect(loadErrorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'check failed' }),
        'key',
        expect.objectContaining({ name: 'isEntryStillCurrentFn' }),
        expect.anything(),
      )
    })

    it('falls back to full refetch when the ttl bump fails', async () => {
      const loader = new CountingDataSource('value')
      const asyncCache = new RedisCache<string>(redis, {
        ttlInMsecs: 150,
        ttlLeftBeforeRefreshInMsecs: 75,
      })
      vitest.spyOn(asyncCache, 'resetTtl').mockRejectedValue(new Error('connection lost'))
      const cacheUpdateErrorHandler = vitest.fn()

      const operation = new Loader<string>({
        asyncCache,
        dataSources: [loader],
        isEntryStillCurrentFn: async () => true,
        cacheUpdateErrorHandler,
      })
      expect(await operation.get('key')).toBe('value')
      expect(loader.counter).toBe(1)

      await setTimeout(100)
      // kick off the check; ttl bump rejects
      expect(await operation.get('key')).toBe('value')
      // Wait for the fallback background refresh to actually call the data source.
      for (let attempt = 0; attempt < 20 && loader.counter < 2; attempt++) {
        await setTimeout(10)
      }
      expect(loader.counter).toBe(2)
      expect(cacheUpdateErrorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'connection lost' }),
        'key',
        asyncCache,
        expect.anything(),
      )
    })

    it('refetches when the entry disappears between the read and the ttl bump', async () => {
      const loader = new CountingDataSource('value')
      const asyncCache = new RedisCache<string>(redis, {
        ttlInMsecs: 150,
        ttlLeftBeforeRefreshInMsecs: 75,
      })

      const operation = new Loader<string>({
        asyncCache,
        dataSources: [loader],
        isEntryStillCurrentFn: async () => {
          // simulate the entry being deleted while the check is in flight
          await asyncCache.delete('key')
          return true
        },
      })
      expect(await operation.get('key')).toBe('value')
      expect(loader.counter).toBe(1)

      await setTimeout(100)
      // kick off the check; ttl bump fails because the entry is gone
      expect(await operation.get('key')).toBe('value')
      // Wait for the fallback background refresh to actually call the data source.
      for (let attempt = 0; attempt < 20 && loader.counter < 2; attempt++) {
        await setTimeout(10)
      }
      expect(loader.counter).toBe(2)
    })

    it('only runs a single staleness check for concurrent gets', async () => {
      const loader = new CountingDataSource('value')
      const asyncCache = new RedisCache<string>(redis, {
        ttlInMsecs: 9999,
        ttlLeftBeforeRefreshInMsecs: 9925,
        ttlCacheTtl: 2000,
      })

      let finishCheck: (isCurrent: boolean) => void
      const checkPromise = new Promise<boolean>((resolve) => {
        finishCheck = resolve
      })
      const isEntryStillCurrentFn = vitest.fn(() => checkPromise)

      const operation = new Loader<string>({
        asyncCache,
        dataSources: [loader],
        isEntryStillCurrentFn,
      })
      expect(await operation.get('key')).toBe('value')
      expect(loader.counter).toBe(1)

      await setTimeout(90)
      // kick off the check and keep it hanging while more gets come in
      expect(await operation.get('key')).toBe('value')
      void operation.get('key')
      void operation.get('key')
      await setTimeout(10)
      finishCheck!(true)
      await setTimeout(10)

      expect(isEntryStillCurrentFn).toHaveBeenCalledTimes(1)
      expect(loader.counter).toBe(1)
    })

    it('does not re-run the check after a ttl bump until the refresh window is reached again', async () => {
      const loader = new CountingDataSource('value')
      const asyncCache = new RedisCache<string>(redis, {
        ttlInMsecs: 500,
        ttlLeftBeforeRefreshInMsecs: 100,
        ttlCacheTtl: 5000,
      })
      const isEntryStillCurrentFn = vitest.fn(async () => true)

      const operation = new Loader<string>({
        asyncCache,
        dataSources: [loader],
        isEntryStillCurrentFn,
      })
      expect(await operation.get('key')).toBe('value')

      await setTimeout(450)
      // kick off the check + bump
      expect(await operation.get('key')).toBe('value')
      for (
        let attempt = 0;
        attempt < 20 && isEntryStillCurrentFn.mock.calls.length < 1;
        attempt++
      ) {
        await setTimeout(10)
      }
      expect(isEntryStillCurrentFn).toHaveBeenCalledTimes(1)

      // ttl was bumped and the cached expiration time invalidated, so gets
      // outside of the refresh window do not re-trigger the check
      await setTimeout(20)
      expect(await operation.get('key')).toBe('value')
      expect(await operation.get('key')).toBe('value')
      await setTimeout(20)
      expect(isEntryStillCurrentFn).toHaveBeenCalledTimes(1)
      expect(loader.counter).toBe(1)
    })

    it('bumps the in-memory ttl as well in a two-layer setup', async () => {
      const loader = new CountingDataSource('value')
      const asyncCache = new RedisCache<string>(redis, {
        ttlInMsecs: 150,
        ttlLeftBeforeRefreshInMsecs: 75,
      })

      const operation = new Loader<string>({
        inMemoryCache: {
          cacheId: 'staleness-two-layer',
          ttlInMsecs: 150,
          ttlLeftBeforeRefreshInMsecs: 75,
        },
        asyncCache,
        dataSources: [loader],
        isEntryStillCurrentFn: async () => true,
      })
      expect(await operation.get('key')).toBe('value')
      // @ts-expect-error
      const inMemoryExpirationPre = operation.inMemoryCache.getExpirationTime('key')

      await setTimeout(100)
      // kick off the check + bump
      expect(await operation.get('key')).toBe('value')
      await setTimeout(30)

      // @ts-expect-error
      const inMemoryExpirationPost = operation.inMemoryCache.getExpirationTime('key')
      expect(inMemoryExpirationPre).toBeDefined()
      expect(inMemoryExpirationPost).toBeDefined()
      expect(inMemoryExpirationPost! > inMemoryExpirationPre!).toBe(true)
      expect(loader.counter).toBe(1)
    })

    it('passes the cached representation of a null value to the staleness check', async () => {
      const loader = new CountingDataSource(null)
      const asyncCache = new RedisCache<string>(redis, {
        ttlInMsecs: 150,
        ttlLeftBeforeRefreshInMsecs: 75,
        json: true,
      })
      const isEntryStillCurrentFn = vitest.fn(async () => true)

      const operation = new Loader<string>({
        asyncCache,
        dataSources: [loader],
        isEntryStillCurrentFn,
      })
      expect(await operation.get('key')).toBe(null)
      expect(loader.counter).toBe(1)

      await setTimeout(100)
      // kick off the check; Redis stores explicitly cached null as an empty string
      expect(await operation.get('key')).toBe('')
      for (
        let attempt = 0;
        attempt < 20 && isEntryStillCurrentFn.mock.calls.length < 1;
        attempt++
      ) {
        await setTimeout(10)
      }
      expect(isEntryStillCurrentFn).toHaveBeenCalledWith('', 'key')
      await setTimeout(10)
      expect(loader.counter).toBe(1)
    })
  })

  describe('constructor', () => {
    it('throws when isEntryStillCurrentFn is set without any refresh window', () => {
      expect(
        () =>
          new Loader<string>({
            dataSources: [new CountingDataSource('value')],
            isEntryStillCurrentFn: async () => true,
          }),
      ).toThrow(/requires a preemptive refresh window/)
    })

    it('accepts isEntryStillCurrentFn with an in-memory-only refresh window', () => {
      expect(
        () =>
          new Loader<string>({
            inMemoryCache: { ttlInMsecs: 150, ttlLeftBeforeRefreshInMsecs: 75 },
            dataSources: [new CountingDataSource('value')],
            isEntryStillCurrentFn: async () => true,
          }),
      ).not.toThrow()
    })

    it('throws when the asyncCache does not support resetTtl', () => {
      expect(
        () =>
          new Loader<string>({
            asyncCache: new DummyCache('value'),
            dataSources: [new CountingDataSource('value')],
            isEntryStillCurrentFn: async () => true,
          }),
      ).toThrow(/does not support resetTtl/)
    })

    it('throws when the asyncCache has no ttlLeftBeforeRefreshInMsecs configured', () => {
      expect(
        () =>
          new Loader<string>({
            asyncCache: new RedisCache<string>(redis, { ttlInMsecs: 150 }),
            dataSources: [new CountingDataSource('value')],
            isEntryStillCurrentFn: async () => true,
          }),
      ).toThrow(/ttlLeftBeforeRefreshInMsecs/)
    })
  })
})
