import Redis from 'ioredis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CacheKeyResolver } from '../lib/AbstractCache'
import { GroupLoader } from '../lib/GroupLoader'
import { Loader } from '../lib/Loader'
import type { InMemoryCacheConfiguration } from '../lib/memory/InMemoryCache'
import type { InMemoryGroupCacheConfiguration } from '../lib/memory/InMemoryGroupCache'
import { RedisCache } from '../lib/redis/RedisCache'
import { RedisGroupCache } from '../lib/redis/RedisGroupCache'
import type { DataSource, GroupDataSource } from '../lib/types/DataSources'
import { CountingDataSource } from './fakes/CountingDataSource'
import { CountingGroupedLoader } from './fakes/CountingGroupedLoader'
import { redisOptions } from './fakes/TestRedisConfig'
import type { User } from './types/testTypes'

const IN_MEMORY_CACHE_CONFIG = {
  ttlInMsecs: 999,
} satisfies InMemoryCacheConfiguration

const IN_MEMORY_GROUP_CACHE_CONFIG = {
  ttlInMsecs: 999,
} satisfies InMemoryGroupCacheConfiguration

const stringIdResolver: CacheKeyResolver<string> = (value) => {
  const number = value.match(/(\d+)/)?.[0] ?? ''
  return `key${number}`
}

const userIdResolver: CacheKeyResolver<User> = (value) => value.userId

const user2: User = { companyId: 'company1', userId: '2' }

describe('Loader cached null', () => {
  let redis: Redis
  beforeEach(async () => {
    redis = new Redis(redisOptions)
    await redis.flushall()
  })
  afterEach(async () => {
    await redis.disconnect()
  })

  it('serves a null cached in the async cache through getMany', async () => {
    const dataSource = new CountingDataSource('value1')
    const asyncCache = new RedisCache<string>(redis, { json: true, ttlInMsecs: 9999 })
    await asyncCache.set('key1', null)

    const operation = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache,
      dataSources: [dataSource],
      cacheKeyFromValueResolver: stringIdResolver,
    })

    expect(await operation.getMany(['key1'])).toEqual([null])
    expect(dataSource.counter).toBe(0)

    expect(operation.getInMemoryOnly('key1')).toBeUndefined()
    expect(await operation.getMany(['key1'])).toEqual([null])
    expect(dataSource.counter).toBe(0)
  })

  it('promotes real values from a mixed batch while skipping the cached null', async () => {
    const dataSource = new CountingDataSource('value2')
    const asyncCache = new RedisCache<string>(redis, { json: true, ttlInMsecs: 9999 })
    await asyncCache.set('key1', null)
    await asyncCache.set('key2', 'value2')

    const operation = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache,
      dataSources: [dataSource],
      cacheKeyFromValueResolver: stringIdResolver,
    })

    // the null comes first, so skipping it must not abandon the rest of the batch
    expect(await operation.getMany(['key1', 'key2'])).toEqual([null, 'value2'])
    expect(dataSource.counter).toBe(0)

    expect(operation.getInMemoryOnly('key2')).toBe('value2')
    expect(operation.getInMemoryOnly('key1')).toBeUndefined()
  })

  it('skips a null returned by a data source instead of failing the whole batch', async () => {
    const dataSource: DataSource<string> = {
      name: 'nullReturningDataSource',
      get: () => Promise.resolve(undefined),
      getMany: () => Promise.resolve([null as unknown as string, 'value2']),
    }
    const asyncCache = new RedisCache<string>(redis, { json: true, ttlInMsecs: 9999 })

    const operation = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache,
      dataSources: [dataSource],
      cacheKeyFromValueResolver: stringIdResolver,
    })

    expect(await operation.getMany(['key1', 'key2'])).toEqual([null, 'value2'])
    expect(await asyncCache.get('key2')).toBe('value2')
  })

  it('skips a null returned by a group data source instead of failing the whole batch', async () => {
    const dataSource: GroupDataSource<User> = {
      name: 'nullReturningGroupDataSource',
      getFromGroup: () => Promise.resolve(undefined),
      getManyFromGroup: () => Promise.resolve([null as unknown as User, user2]),
    }
    const asyncCache = new RedisGroupCache<User>(redis, { json: true, ttlInMsecs: 9999 })

    const operation = new GroupLoader<User>({
      inMemoryCache: IN_MEMORY_GROUP_CACHE_CONFIG,
      asyncCache,
      dataSources: [dataSource],
      cacheKeyFromValueResolver: userIdResolver,
    })

    expect(await operation.getMany(['1', '2'], 'company1')).toEqual([null, user2])
    expect(await asyncCache.getFromGroup('2', 'company1')).toEqual(user2)
  })

  it('serves a null cached in the async group cache through getMany', async () => {
    const dataSource = new CountingGroupedLoader({})
    const asyncCache = new RedisGroupCache<User>(redis, { json: true, ttlInMsecs: 9999 })
    await asyncCache.setForGroup('1', null, 'company1')

    const operation = new GroupLoader<User>({
      inMemoryCache: IN_MEMORY_GROUP_CACHE_CONFIG,
      asyncCache,
      dataSources: [dataSource],
      cacheKeyFromValueResolver: userIdResolver,
    })

    expect(await operation.getMany(['1'], 'company1')).toEqual([null])
    expect(dataSource.counter).toBe(0)

    expect(operation.getInMemoryOnly('1', 'company1')).toBeUndefined()
    expect(await operation.getMany(['1'], 'company1')).toEqual([null])
    expect(dataSource.counter).toBe(0)
  })
})
