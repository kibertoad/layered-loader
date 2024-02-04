import { setTimeout } from 'timers/promises'
import { HitStatisticsRecord } from 'toad-cache'
import { afterEach, beforeEach, expect, vitest } from 'vitest'
import type { LoaderConfig } from '../lib/Loader'
import { Loader } from '../lib/Loader'
import type { InMemoryCacheConfiguration } from '../lib/memory/InMemoryCache'
import type { IdResolver } from '../lib/types/DataSources'
import { CountingDataSource } from './fakes/CountingDataSource'
import { CountingRecordLoader } from './fakes/CountingRecordLoader'
import { CountingTimedCache } from './fakes/CountingTimedCache'
import { DummyCache } from './fakes/DummyCache'
import { DummyDataSource } from './fakes/DummyDataSource'
import type { DummyLoaderParams } from './fakes/DummyLoaderWithParams'
import { DummyLoaderWithParams } from './fakes/DummyLoaderWithParams'
import { DummyNotificationConsumer } from './fakes/DummyNotificationConsumer'
import { DummyNotificationConsumerMultiplexer } from './fakes/DummyNotificationConsumerMultiplexer'
import { DummyNotificationPublisher } from './fakes/DummyNotificationPublisher'
import { DummyRecordCache } from './fakes/DummyRecordCache'
import { TemporaryThrowingLoader } from './fakes/TemporaryThrowingLoader'
import { ThrowingCache } from './fakes/ThrowingCache'
import { ThrowingLoader } from './fakes/ThrowingLoader'
import { getTimestamp } from './utils/dateUtils'

const IN_MEMORY_CACHE_CONFIG = {
  ttlInMsecs: 999,
} satisfies InMemoryCacheConfiguration

const idResolver: IdResolver<string> = (value) => {
  const number = value.match(/(\d+)/)?.[0] ?? ''
  return `key${number}`
}

describe('Loader Main', () => {
  beforeEach(async () => {
    vitest.resetAllMocks()
  })

  describe('notificationConsumer', () => {
    it('Handles simple notification consumer', async () => {
      const notificationConsumer = new DummyNotificationConsumer('a')

      const operation = new Loader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyCache('value'),
        notificationConsumer,
      })

      await operation.getAsyncOnly('key')
      const resultPre = operation.getInMemoryOnly('key')
      notificationConsumer.set('key', 'value2')
      const resultPost = operation.getInMemoryOnly('key')

      expect(resultPre).toBe('value')
      expect(resultPost).toBe('value2')
    })

    it('Handles simple notification publisher', async () => {
      const notificationConsumer = new DummyNotificationConsumer('a')
      const notificationPublisher = new DummyNotificationPublisher(notificationConsumer)

      const operation = new Loader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyCache('value'),
        notificationConsumer,
        notificationPublisher,
      })

      await operation.getAsyncOnly('key')
      const resultPre = operation.getInMemoryOnly('key')
      await notificationPublisher.set('key', 'value2')
      const resultPost = operation.getInMemoryOnly('key')

      expect(resultPre).toBe('value')
      expect(resultPost).toBe('value2')
    })

    it('Propagates invalidation event to remote cache', async () => {
      const notificationConsumer1 = new DummyNotificationConsumer('a')
      const notificationConsumer2 = new DummyNotificationConsumer('b')
      const notificationMultiplexer = new DummyNotificationConsumerMultiplexer([
        notificationConsumer1,
        notificationConsumer2,
      ])
      const notificationPublisher1 = new DummyNotificationPublisher(notificationMultiplexer)
      const notificationPublisher2 = new DummyNotificationPublisher(notificationMultiplexer)

      const operation = new Loader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyCache('value'),
        notificationConsumer: notificationConsumer1,
        notificationPublisher: notificationPublisher1,
      })

      const operation2 = new Loader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyCache('value'),
        notificationConsumer: notificationConsumer2,
        notificationPublisher: notificationPublisher2,
      })

      await operation.getAsyncOnly('key')
      await operation2.getAsyncOnly('key')
      const resultPre1 = operation.getInMemoryOnly('key')
      const resultPre2 = operation2.getInMemoryOnly('key')
      await operation.invalidateCacheFor('key')
      const resultPost1 = operation.getInMemoryOnly('key')
      const resultPost2 = operation2.getInMemoryOnly('key')

      expect(resultPre1).toBe('value')
      expect(resultPre2).toBe('value')

      expect(resultPost1).toBeUndefined()
      expect(resultPost2).toBeUndefined()
    })

    it('Propagates complete invalidation event to remote cache', async () => {
      const notificationConsumer1 = new DummyNotificationConsumer('a')
      const notificationConsumer2 = new DummyNotificationConsumer('b')
      const notificationMultiplexer = new DummyNotificationConsumerMultiplexer([
        notificationConsumer1,
        notificationConsumer2,
      ])
      const notificationPublisher1 = new DummyNotificationPublisher(notificationMultiplexer)
      const notificationPublisher2 = new DummyNotificationPublisher(notificationMultiplexer)

      const operation = new Loader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyCache('value'),
        notificationConsumer: notificationConsumer1,
        notificationPublisher: notificationPublisher1,
      })

      const operation2 = new Loader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyCache('value'),
        notificationConsumer: notificationConsumer2,
        notificationPublisher: notificationPublisher2,
      })

      await operation.getAsyncOnly('key')
      await operation2.getAsyncOnly('key')
      const resultPre1 = operation.getInMemoryOnly('key')
      const resultPre2 = operation2.getInMemoryOnly('key')
      await operation.invalidateCache()
      const resultPost1 = operation.getInMemoryOnly('key')
      const resultPost2 = operation2.getInMemoryOnly('key')

      expect(resultPre1).toBe('value')
      expect(resultPre2).toBe('value')

      expect(resultPost1).toBeUndefined()
      expect(resultPost2).toBeUndefined()
    })

    it('Closes notification consumer and publisher', async () => {
      const notificationConsumer = new DummyNotificationConsumer('a')
      const notificationPublisher = new DummyNotificationPublisher(notificationConsumer)

      const operation = new Loader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyCache('value'),
        notificationConsumer,
        notificationPublisher,
      })

      await operation.close()
      expect(notificationConsumer.closed).toBe(true)
      expect(notificationPublisher.closed).toBe(true)
    })

    it('Throws an error when resetting target cache', async () => {
      const notificationConsumer = new DummyNotificationConsumer('a')

      new Loader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyCache('value'),
        notificationConsumer,
      })

      expect(() => {
        notificationConsumer.setTargetCache(null)
      }).toThrow(/Cannot modify already set target cache/)
    })

    it('Throws an error when inmemory cache is disabled', async () => {
      const notificationConsumer = new DummyNotificationConsumer('a')

      expect(() => {
        new Loader({
          asyncCache: new DummyCache('value'),
          notificationConsumer,
        })
      }).toThrow(/Cannot set notificationConsumer when InMemoryCache is disabled/)
    })
  })

  describe('getInMemoryOnly', () => {
    it('returns undefined when no inmemory cache is configured', () => {
      const operation = new Loader({})

      const result = operation.getInMemoryOnly('value')

      expect(result).toBeUndefined()
    })

    it('returns undefined when no value is cached', () => {
      const operation = new Loader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      })

      const result = operation.getInMemoryOnly('value')

      expect(result).toBeUndefined()
    })

    it('returns statistics when appropriate cache type is used', () => {
      const record = new HitStatisticsRecord()
      const operation = new Loader({
        inMemoryCache: {
          ttlInMsecs: 99999,
          cacheId: 'some cache',
          globalStatisticsRecord: record,
          cacheType: 'lru-object-statistics',
        },
      })

      operation.getInMemoryOnly('value')

      const timestamp = getTimestamp(new Date())
      expect(record.records).toEqual({
        'some cache': {
          [timestamp]: {
            cacheSize: 0,
            emptyHits: 0,
            evictions: 0,
            expirations: 0,
            falsyHits: 0,
            hits: 0,
            invalidateAll: 0,
            invalidateOne: 0,
            misses: 1,
            sets: 0,
          },
        },
      })
    })

    it('throws an error when statistics with no cache id are used', () => {
      const record = new HitStatisticsRecord()
      expect(
        () =>
          new Loader({
            inMemoryCache: {
              ttlInMsecs: 99999,
              globalStatisticsRecord: record,
              cacheType: 'lru-object-statistics',
            },
          }),
      ).toThrow(/Cache id is mandatory/)
    })

    it('returns cached value', async () => {
      const operation = new Loader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyCache('value'),
      })

      const resultPre = operation.getInMemoryOnly('key')
      await operation.getAsyncOnly('key')
      const resultPost = operation.getInMemoryOnly('key')

      expect(resultPre).toBeUndefined()
      expect(resultPost).toBe('value')
    })

    it('triggers background refresh when threshold is set and reached', async () => {
      const loader = new CountingDataSource('value')

      const operation = new Loader<string>({
        inMemoryCache: {
          cacheId: 'dummy',
          ttlInMsecs: 150,
          ttlLeftBeforeRefreshInMsecs: 75,
        },
        dataSources: [loader],
      })
      expect(operation.getInMemoryOnly('key')).toBeUndefined()
      expect(loader.counter).toBe(0)
      expect(await operation.get('key')).toBe('value')
      expect(loader.counter).toBe(1)
      // @ts-ignore
      const expirationTimePre = operation.inMemoryCache.getExpirationTime('key')

      await setTimeout(100)
      expect(loader.counter).toBe(1)
      // kick off the refresh
      expect(operation.getInMemoryOnly('key')).toBe('value')
      await Promise.resolve()
      expect(loader.counter).toBe(2)

      // FIXME these promise.resolve weren't needed, until it suddenly stopped failing without any changes. Need to investigate, what is going on.
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      // @ts-ignore
      const expirationTimePost = operation.inMemoryCache.getExpirationTime('key')

      expect(operation.getInMemoryOnly('key')).toBe('value')
      await Promise.resolve()
      expect(loader.counter).toBe(2)
      expect(expirationTimePre).toBeDefined()
      expect(expirationTimePost).toBeDefined()
      expect(expirationTimePost! > expirationTimePre!).toBe(true)
    })
  })

  describe('getManyInMemoryOnly', () => {
    it('returns empty result when no inmemory cache is configured', () => {
      const operation = new Loader({})

      const result = operation.getManyInMemoryOnly(['value', 'value2'])

      expect(result).toEqual({
        resolvedValues: [],
        unresolvedKeys: ['value', 'value2'],
      })
    })

    it('returns empty result when no value is cached', () => {
      const operation = new Loader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      })

      const result = operation.getManyInMemoryOnly(['value', 'value2'])

      expect(result).toEqual({
        resolvedValues: [],
        unresolvedKeys: ['value', 'value2'],
      })
    })

    it('returns cached value', async () => {
      const operation = new Loader({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new DummyCache('value'),
      })

      const resultPre = operation.getManyInMemoryOnly(['key', 'key2'])
      await operation.getAsyncOnly('key')
      const resultPost = operation.getManyInMemoryOnly(['key', 'key2'])

      const result = operation.getManyInMemoryOnly(['key', 'key2'])

      expect(result).toEqual({
        resolvedValues: ['value'],
        unresolvedKeys: ['key2'],
      })

      expect(resultPre).toEqual({
        resolvedValues: [],
        unresolvedKeys: ['key', 'key2'],
      })
      expect(resultPost).toEqual({
        resolvedValues: ['value'],
        unresolvedKeys: ['key2'],
      })
    })
  })

  describe('constructor', () => {
    it('throws an error if both datasource and datasource fns are provided', () => {
      expect(() => {
        new Loader({
          dataSources: [],
          dataSourceGetOneFn: () => {
            return Promise.resolve('x')
          },
        })
      }).toThrow(/Cannot set both/)
    })
  })

  describe('get', () => {
    it('returns undefined when fails to resolve value', async () => {
      const operation = new Loader({})

      const result = await operation.get('value')

      expect(result).toBeUndefined()
    })

    it('throws when fails to resolve value, no loaders and flag is set', async () => {
      const operation = new Loader({
        throwIfUnresolved: true,
      })

      await expect(() => {
        return operation.get('value')
      }).rejects.toThrow(/Failed to resolve value for key "value"/)
    })

    it('throws when fails to resolve value, and flag is set', async () => {
      const operation = new Loader({
        throwIfUnresolved: true,
        dataSources: [new DummyDataSource(undefined)],
      })

      await expect(() => {
        return operation.get('value')
      }).rejects.toThrow(/Failed to resolve value for key "value"/)
    })

    it('does not throw when flag is set, but loader can resolve the value', async () => {
      const cache = new DummyCache(undefined)
      const loader = new DummyDataSource('value')

      const operation = new Loader({
        asyncCache: cache,
        dataSources: [loader],
        throwIfUnresolved: true,
      })

      const value = await operation.get('key')
      expect(value).toBe('value')
    })

    it('logs error during load', async () => {
      const consoleSpy = vitest.spyOn(console, 'error')
      const operation = new Loader({ dataSources: [new ThrowingLoader()], throwIfLoadError: true })

      await expect(() => {
        return operation.get('value')
      }).rejects.toThrow(/Error has occurred/)
      expect(consoleSpy).toHaveBeenCalledTimes(1)
    })

    it('resets loading operation after value was not found previously', async () => {
      const loader = new DummyDataSource(undefined)
      const operation = new Loader({ dataSources: [loader] })

      const value = await operation.get('value')
      expect(value).toBeNull()

      loader.value = null
      const value2 = await operation.get('value')
      expect(value2).toBeNull()

      loader.value = 'value'
      const value3 = await operation.get('dummy')
      expect(value3).toBe('value')
    })

    it('resets loading operation after error during load', async () => {
      const loader = new TemporaryThrowingLoader('value')
      const operation = new Loader({ dataSources: [loader] })

      await expect(() => {
        return operation.get('value')
      }).rejects.toThrow(/Error has occurred/)

      loader.isThrowing = false
      const value = await operation.get('dummy')
      expect(value).toBe('value')
    })

    it('handles error during cache update', async () => {
      const consoleSpy = vitest.spyOn(console, 'error')
      const operation = new Loader({
        asyncCache: new ThrowingCache(),
        dataSources: [new DummyDataSource('value')],
      })
      const value = await operation.get('value')
      expect(value).toBe('value')
      expect(consoleSpy).toHaveBeenCalledTimes(2)
    })

    it('returns value when resolved via single loader', async () => {
      const operation = new Loader<string>({ inMemoryCache: IN_MEMORY_CACHE_CONFIG })
      // @ts-ignore
      operation.inMemoryCache.set('key', 'value')

      const result = await operation.get('key')

      expect(result).toBe('value')
    })

    it('returns value when resolved via generated loader', async () => {
      const operation = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        dataSourceGetOneFn: (key) => {
          if (key === 'key') {
            return Promise.resolve('value')
          }
          throw new Error('Not found')
        },
      })

      const result = await operation.get('key')

      expect(result).toBe('value')
    })

    it('throws an error if requested generated loader is not set', async () => {
      const operation = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        dataSourceGetManyFn: (keys) => {
          if (keys[0] === 'key') {
            return Promise.resolve(['value'])
          }
          throw new Error('Not found')
        },
      })

      await expect(operation.get('key')).rejects.toThrow(/Retrieval of a single entity is not/)
    })

    it('returns value when resolved via multiple loaders', async () => {
      const asyncCache = new DummyCache(undefined)

      const operation = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: asyncCache,
      })
      await asyncCache.set('key', 'value')

      const result = await operation.get('key')

      expect(result).toBe('value')
    })

    it('updates upper level cache when resolving value downstream', async () => {
      const cache2 = new DummyCache(undefined)
      const operation = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [new DummyDataSource(undefined), new DummyDataSource('value')],
      })
      // @ts-ignore
      const cache1 = operation.inMemoryCache

      const valuePre = await cache1.get('key')
      await operation.get('key')
      const valuePost = await cache1.get('key')
      const valuePost2 = await cache2.get('key')

      expect(valuePre).toBeUndefined()
      expect(valuePost).toBe('value')
      expect(valuePost2).toBe('value')
    })

    it('passes loadParams to the loader', async () => {
      const cache2 = new DummyCache(undefined)
      const operation = new Loader<string, DummyLoaderParams>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [new DummyLoaderWithParams('value')],
      })
      // @ts-ignore
      const cache1 = operation.inMemoryCache

      const valuePre = await cache1.get('key')
      await operation.get('key', { prefix: 'pre', suffix: 'post' })
      const valuePost = await cache1.get('key')
      const valuePost2 = await cache2.get('key')

      expect(valuePre).toBeUndefined()
      expect(valuePost).toBe('prevaluepost')
      expect(valuePost2).toBe('prevaluepost')
    })

    it('correctly reuses value from cache', async () => {
      const cache2 = new DummyCache(undefined)
      const loader1 = new CountingDataSource(undefined)
      const loader2 = new CountingDataSource('value')

      const operation = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [loader1, loader2],
      })

      const valuePre = await operation.get('key')
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe('value')
      expect(loader2.counter).toBe(1)
    })

    it('batches identical retrievals together', async () => {
      const loader = new CountingDataSource('value')

      const operation = new Loader<string>({ dataSources: [loader] })
      const valuePromise = operation.get('key')
      const valuePromise2 = operation.get('key')

      const value = await valuePromise
      const value2 = await valuePromise2

      expect(value).toBe('value')
      expect(value2).toBe('value')
      expect(loader.counter).toBe(1)
    })
  })

  describe('getMany', () => {
    it('returns empty list when fails to resolve value', async () => {
      const operation = new Loader<string>({})

      const result = await operation.getMany(['key', 'key2'], idResolver)

      expect(result).toEqual([])
    })

    it('throws when fails to resolve value, no loaders and flag is set', async () => {
      const operation = new Loader<string>({
        throwIfUnresolved: true,
      })

      await expect(() => {
        return operation.getMany(['key1', 'key2'], idResolver)
      }).rejects.toThrow(/Failed to resolve value for some of the keys: key1, key2/)
    })

    it('throws when fails to resolve value, and flag is set', async () => {
      const operation = new Loader<string>({
        throwIfUnresolved: true,
        dataSources: [new DummyDataSource(undefined)],
      })

      await expect(() => {
        return operation.getMany(['key1', 'key2'], idResolver)
      }).rejects.toThrow(/Failed to resolve value for some of the keys: key1, key2/)
    })

    it('does not throw when flag is set, but loader can resolve the value', async () => {
      const cache = new DummyRecordCache({})
      const loader = new CountingRecordLoader({
        key: 'value',
        key2: 'value2',
      })

      const operation = new Loader<string>({
        asyncCache: cache,
        dataSources: [loader],
        throwIfUnresolved: true,
      })

      const value = await operation.getMany(['key', 'key2'], idResolver)
      expect(value).toEqual(['value', 'value2'])
    })

    it('logs error during load', async () => {
      const consoleSpy = vitest.spyOn(console, 'error')
      const operation = new Loader<string>({
        dataSources: [new ThrowingLoader()],
        throwIfLoadError: true,
      })

      await expect(() => {
        return operation.getMany(['value'], idResolver)
      }).rejects.toThrow(/Error has occurred/)
      expect(consoleSpy).toHaveBeenCalledTimes(1)
    })

    it('returns empty result if flag is not set and error is thrown', async () => {
      const consoleSpy = vitest.spyOn(console, 'error')
      const operation = new Loader<string>({
        dataSources: [new ThrowingLoader()],
        throwIfLoadError: false,
      })

      const result = await operation.getMany(['value'], idResolver)

      expect(result).toEqual([])
      expect(consoleSpy).toHaveBeenCalledTimes(1)
    })

    it('resets loading operation after value was not found previously', async () => {
      const loader = new DummyDataSource(undefined)
      const operation = new Loader<string>({ dataSources: [loader] })

      const value = await operation.getMany(['value'], idResolver)
      expect(value).toEqual([])

      loader.value = null
      const value2 = await operation.getMany(['value'], idResolver)
      expect(value2).toEqual([])

      loader.value = 'value'
      const value3 = await operation.getMany(['dummy'], idResolver)
      expect(value3).toEqual(['value'])
    })

    it('resets loading operation after error during load', async () => {
      const loader = new TemporaryThrowingLoader('value')
      const operation = new Loader<string>({ dataSources: [loader] })

      await expect(() => {
        return operation.getMany(['value'], idResolver)
      }).rejects.toThrow(/Error has occurred/)

      loader.isThrowing = false
      const value = await operation.getMany(['dummy'], idResolver)
      expect(value).toEqual(['value'])
    })

    it('handles error during cache update', async () => {
      const consoleSpy = vitest.spyOn(console, 'error')
      const operation = new Loader<string>({
        asyncCache: new ThrowingCache(),
        dataSources: [new DummyDataSource('value')],
      })
      const value = await operation.getMany(['value'], idResolver)
      expect(value).toEqual(['value'])
      expect(consoleSpy).toHaveBeenCalledTimes(2)
    })

    it('returns value when resolved via single cache', async () => {
      const operation = new Loader<string>({ inMemoryCache: IN_MEMORY_CACHE_CONFIG })
      // @ts-ignore
      operation.inMemoryCache.set('key', 'value')

      const result = await operation.getMany(['key'], idResolver)

      expect(result).toEqual(['value'])
    })

    it('returns value when resolved via generated loader', async () => {
      const operation = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        dataSourceGetManyFn: (keys: string[]) => {
          if (keys.includes('key')) {
            return Promise.resolve(['value'])
          }

          throw new Error('Not found')
        },
      })

      const result = await operation.getMany(['key'], idResolver)

      expect(result).toEqual(['value'])
    })

    it('throws an error if requested generated loader is not set', async () => {
      const operation = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        dataSourceGetOneFn: (key) => {
          if (key === 'key') {
            return Promise.resolve('value')
          }
          throw new Error('Not found')
        },
      })

      await expect(operation.getMany(['key'], idResolver)).rejects.toThrow(/Retrieval of multiple entities/)
    })

    it('returns value when resolved via multiple caches', async () => {
      const asyncCache = new DummyCache(undefined)

      const operation = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: asyncCache,
      })
      asyncCache.value = 'value'

      const result = await operation.getMany(['key', 'key2'], idResolver)

      expect(result).toEqual(['value', 'value'])
    })

    it('updates upper level cache when resolving value downstream', async () => {
      const asyncCache = new DummyRecordCache({})
      const operation = new Loader<string>({
        inMemoryCache: {
          ...IN_MEMORY_CACHE_CONFIG,
        },
        asyncCache: asyncCache,
        dataSources: [
          new CountingRecordLoader({}),
          new CountingRecordLoader({
            key: 'value',
            key2: 'value2',
          }),
        ],
      })
      // @ts-ignore
      const inMemoryCache = operation.inMemoryCache

      const valuePre = inMemoryCache.getMany(['key'])
      await operation.getMany(['key'], idResolver)
      const valuePost = inMemoryCache.getMany(['key'])
      const valuePost2 = await asyncCache.getMany(['key'])

      expect(valuePre).toEqual({
        resolvedValues: [],
        unresolvedKeys: ['key'],
      })
      expect(valuePost).toEqual({
        resolvedValues: ['value'],
        unresolvedKeys: [],
      })
      expect(valuePost2).toEqual({
        resolvedValues: ['value'],
        unresolvedKeys: [],
      })
    })

    it('passes loadParams to the loader', async () => {
      const cache2 = new DummyRecordCache({})
      const operation = new Loader<string, DummyLoaderParams>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [new DummyLoaderWithParams('value')],
      })
      // @ts-ignore
      const cache1 = operation.inMemoryCache

      const valuePre = cache1.getMany(['key'])
      await operation.getMany(['key'], idResolver, { prefix: 'pre', suffix: 'post' })
      const valuePost = cache1.getMany(['key'])
      const valuePost2 = await cache2.getMany(['key'])

      expect(valuePre).toEqual({
        resolvedValues: [],
        unresolvedKeys: ['key'],
      })
      expect(valuePost).toEqual({
        resolvedValues: ['value'],
        unresolvedKeys: [],
      })
      expect(valuePost2).toEqual({
        resolvedValues: ['value'],
        unresolvedKeys: [],
      })
    })

    it('correctly reuses value from cache', async () => {
      const cache2 = new DummyRecordCache({})
      const loader1 = new CountingRecordLoader({})
      const loader2 = new CountingRecordLoader({
        key: 'value',
        key2: 'value2',
      })

      const operation = new Loader<string>({
        inMemoryCache: {
          ...IN_MEMORY_CACHE_CONFIG,
          ttlInMsecs: 999999999,
        },
        asyncCache: cache2,
        dataSources: [loader1, loader2],
      })

      const valuePre = await operation.getMany(['key', 'key2'], idResolver)
      const valuePost = await operation.getMany(['key', 'key2'], idResolver)

      expect(valuePre).toEqual(['value', 'value2'])
      expect(valuePost).toEqual(['value', 'value2'])
      expect(loader2.counter).toBe(1)
    })

    // Batching multiple very different queries is likely to be very complex and hit perf hard
    it('does not batch identical retrievals together', async () => {
      const loader = new CountingRecordLoader({
        key: 'value',
        key2: 'value2',
      })

      const operation = new Loader<string>({ dataSources: [loader] })
      const valuePromise = operation.getMany(['key', 'key2'], idResolver)
      const valuePromise2 = operation.getMany(['key', 'key2'], idResolver)
      const valuePromise3 = operation.get('key')

      const value = await valuePromise
      const value2 = await valuePromise2
      const value3 = await valuePromise3

      expect(value).toEqual(['value', 'value2'])
      expect(value2).toEqual(['value', 'value2'])
      expect(value3).toBe('value')
      expect(loader.counter).toBe(3)
    })
  })

  describe('invalidateCacheFor', () => {
    it('correctly invalidates cache', async () => {
      const cache2 = new DummyCache(undefined)
      const loader1 = new CountingDataSource(undefined)
      const loader2 = new CountingDataSource('value')

      const operation = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [loader1, loader2],
      })

      const valuePre = await operation.get('key')
      await operation.invalidateCacheFor('key')
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe('value')
      expect(loader2.counter).toBe(2)
    })

    it('correctly handles errors during invalidation', async () => {
      const cache2 = new ThrowingCache()
      const loader1 = new CountingDataSource(undefined)
      const loader2 = new CountingDataSource('value')

      const operation = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [loader1, loader2],
      })

      const valuePre = await operation.get('key')

      await operation.invalidateCacheFor('key')
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe('value')
      expect(loader2.counter).toBe(2)
    })
  })

  describe('invalidateCacheForMany', () => {
    it('invalidates multiple entries', async () => {
      const cache2 = new DummyRecordCache({})
      const loader1 = new CountingDataSource(undefined)
      const loader2 = new CountingDataSource('value')

      const operation = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [loader1, loader2],
      })

      const value1Pre = await operation.get('key')
      const value2Pre = await operation.get('key2')
      const value3Pre = await operation.get('key3')
      await operation.invalidateCacheForMany(['key', 'key3'])
      const value1Post = await operation.get('key')
      const value2Post = await operation.get('key2')
      const value3Post = await operation.get('key3')

      expect(value1Pre).toBe('value')
      expect(value1Post).toBe('value')
      expect(value2Pre).toBe('value')
      expect(value2Post).toBe('value')
      expect(value3Pre).toBe('value')
      expect(value3Post).toBe('value')
      expect(loader2.counter).toBe(5)
    })

    it('correctly handles errors during invalidation', async () => {
      const cache2 = new ThrowingCache()
      const loader1 = new CountingDataSource(undefined)
      const loader2 = new CountingDataSource('value')

      const operation = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [loader1, loader2],
      })

      const valuePre = await operation.get('key')

      await operation.invalidateCacheFor('key')
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe('value')
      expect(loader2.counter).toBe(2)
    })
  })

  describe('invalidateCache', () => {
    it('correctly invalidates cache', async () => {
      const cache2 = new DummyCache(undefined)
      const loader1 = new CountingDataSource(undefined)
      const loader2 = new CountingDataSource('value')

      const operation = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [loader1, loader2],
      })

      const valuePre = await operation.get('key')

      await operation.invalidateCache()
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe('value')
      expect(loader2.counter).toBe(2)
    })

    it('correctly handles errors during invalidation', async () => {
      const cache2 = new ThrowingCache()
      const loader1 = new CountingDataSource(undefined)
      const loader2 = new CountingDataSource('value')

      const operation = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: cache2,
        dataSources: [loader1, loader2],
      })

      const valuePre = await operation.get('key')

      await operation.invalidateCache()
      const valuePost = await operation.get('key')

      expect(valuePre).toBe('value')
      expect(valuePost).toBe('value')
      expect(loader2.counter).toBe(2)
    })
  })

  describe('end-to-end', () => {
    beforeEach(() => {
      vitest.useFakeTimers({
        toFake: ['Date'],
      })
      vitest.setSystemTime('2024-01-05')
    })

    afterEach(() => {
      vitest.useRealTimers()
    })

    it('Uses long in-memory cache with async cache', async () => {
      const ONE_HOUR_IN_MSECS = 1000 * 60 * 60
      const IN_MEMORY_CACHE_TTL = ONE_HOUR_IN_MSECS * 6
      const IN_MEMORY_CONFIGURATION_BASE: InMemoryCacheConfiguration = {
        ttlInMsecs: IN_MEMORY_CACHE_TTL,
        cacheType: 'fifo-map',
      }

      const asyncCache = new CountingTimedCache(1000, ONE_HOUR_IN_MSECS * 8)
      const dataSource = new CountingDataSource('value')

      const config: LoaderConfig<string> = {
        inMemoryCache: {
          ...IN_MEMORY_CONFIGURATION_BASE,
          cacheId: 'cache',
          maxItems: 10000,
        },
        asyncCache: asyncCache,
        dataSources: [dataSource],
      }

      const key = 'key'
      const loader = new Loader(config)

      const value1 = loader.getInMemoryOnly(key) || (await loader.getAsyncOnly(key))
      expect(value1).toBe('value')
      expect(asyncCache.counter).toBe(1)
      expect(dataSource.counter).toBe(1)

      const value2 = loader.getInMemoryOnly(key) || (await loader.getAsyncOnly(key))
      expect(value2).toBe('value')
      expect(asyncCache.counter).toBe(1)
      expect(dataSource.counter).toBe(1)

      vitest.advanceTimersByTime(ONE_HOUR_IN_MSECS * 5)

      const value3 = loader.getInMemoryOnly(key) || (await loader.getAsyncOnly(key))
      expect(value3).toBe('value')
      expect(asyncCache.counter).toBe(1)
      expect(dataSource.counter).toBe(1)

      vitest.advanceTimersByTime(ONE_HOUR_IN_MSECS + 1)

      const value4 = loader.getInMemoryOnly(key) || (await loader.getAsyncOnly(key))
      expect(value4).toBe('value')
      expect(asyncCache.counter).toBe(2)
      expect(dataSource.counter).toBe(1)

      vitest.advanceTimersByTime(IN_MEMORY_CACHE_TTL + 1)

      const value5 = loader.getInMemoryOnly(key) || (await loader.getAsyncOnly(key))
      expect(value5).toBe('value')
      expect(asyncCache.counter).toBe(3)
      expect(dataSource.counter).toBe(2)
    })

    it('Uses long in-memory cache', async () => {
      const ONE_HOUR_IN_MSECS = 1000 * 60 * 60
      const IN_MEMORY_CACHE_TTL = ONE_HOUR_IN_MSECS * 6
      const IN_MEMORY_CONFIGURATION_BASE: InMemoryCacheConfiguration = {
        ttlInMsecs: IN_MEMORY_CACHE_TTL,
        cacheType: 'fifo-map',
      }

      const dataSource = new CountingDataSource('value')

      const config: LoaderConfig<string> = {
        inMemoryCache: {
          ...IN_MEMORY_CONFIGURATION_BASE,
          cacheId: 'cache',
          maxItems: 10000,
        },
        dataSources: [dataSource],
      }

      const key = 'key'
      const loader = new Loader(config)

      const value1 = loader.getInMemoryOnly(key) || (await loader.getAsyncOnly(key))
      expect(value1).toBe('value')
      expect(dataSource.counter).toBe(1)

      const value2 = loader.getInMemoryOnly(key) || (await loader.getAsyncOnly(key))
      expect(value2).toBe('value')
      expect(dataSource.counter).toBe(1)

      vitest.advanceTimersByTime(ONE_HOUR_IN_MSECS * 5)

      const value3 = loader.getInMemoryOnly(key) || (await loader.getAsyncOnly(key))
      expect(value3).toBe('value')
      expect(dataSource.counter).toBe(1)

      // expire in-memory cache
      vitest.advanceTimersByTime(ONE_HOUR_IN_MSECS + 1)

      const value4 = loader.getInMemoryOnly(key) || (await loader.getAsyncOnly(key))
      expect(value4).toBe('value')
      expect(dataSource.counter).toBe(2)

      vitest.advanceTimersByTime(IN_MEMORY_CACHE_TTL - 1)

      const value5 = loader.getInMemoryOnly(key) || (await loader.getAsyncOnly(key))
      expect(value5).toBe('value')
      expect(dataSource.counter).toBe(2)

      vitest.advanceTimersByTime(1)

      const value6 = loader.getInMemoryOnly(key) || (await loader.getAsyncOnly(key))
      expect(value6).toBe('value')
      expect(dataSource.counter).toBe(3)
    })

    it('Uses long in-memory cache with nullish caching', async () => {
      const ONE_HOUR_IN_MSECS = 1000 * 60 * 60
      const IN_MEMORY_CACHE_TTL = ONE_HOUR_IN_MSECS * 6
      const IN_MEMORY_CONFIGURATION_BASE: InMemoryCacheConfiguration = {
        ttlInMsecs: IN_MEMORY_CACHE_TTL,
        cacheType: 'fifo-map',
      }

      const dataSource = new CountingDataSource(null)

      const config: LoaderConfig<string> = {
        inMemoryCache: {
          ...IN_MEMORY_CONFIGURATION_BASE,
          cacheId: 'cache',
          maxItems: 10000,
        },
        dataSources: [dataSource],
      }

      const key = 'key'
      const loader = new Loader(config)

      let value1: string | undefined | null
      value1 = loader.getInMemoryOnly(key)
      if (value1 === undefined) {
        value1 = await loader.getAsyncOnly(key)
      }
      expect(value1).toBeNull()
      expect(dataSource.counter).toBe(1)

      let value2: string | undefined | null
      value2 = loader.getInMemoryOnly(key)
      if (value2 === undefined) {
        value2 = await loader.getAsyncOnly(key)
      }
      expect(value2).toBeNull()
      expect(dataSource.counter).toBe(1)

      vitest.advanceTimersByTime(ONE_HOUR_IN_MSECS * 5)

      let value3: string | undefined | null
      value3 = loader.getInMemoryOnly(key)
      if (value3 === undefined) {
        value3 = await loader.getAsyncOnly(key)
      }
      expect(value3).toBeNull()
      expect(dataSource.counter).toBe(1)

      // expire in-memory cache
      vitest.advanceTimersByTime(ONE_HOUR_IN_MSECS + 1)

      let value4: string | undefined | null
      value4 = loader.getInMemoryOnly(key)
      if (value4 === undefined) {
        value4 = await loader.getAsyncOnly(key)
      }
      expect(value4).toBeNull()
      expect(dataSource.counter).toBe(2)

      vitest.advanceTimersByTime(IN_MEMORY_CACHE_TTL - 1)

      let value5: string | undefined | null
      value5 = loader.getInMemoryOnly(key)
      if (value5 === undefined) {
        value5 = await loader.getAsyncOnly(key)
      }
      expect(value5).toBeNull()
      expect(dataSource.counter).toBe(2)

      vitest.advanceTimersByTime(1)

      let value6: string | undefined | null
      value6 = loader.getInMemoryOnly(key)
      if (value6 === undefined) {
        value6 = await loader.getAsyncOnly(key)
      }
      expect(value6).toBeNull()
      expect(dataSource.counter).toBe(3)
    })
  })
})
