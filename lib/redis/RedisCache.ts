import type { Cache, DataSource } from '../types/DataSources'
import type { Redis } from 'ioredis'
import { Loader } from '../Loader'
import { RedisExpirationTimeDataSource } from './RedisExpirationTimeDataSource'
import type { RedisCacheConfiguration } from './AbstractRedisCache'
import { AbstractRedisCache, DEFAULT_REDIS_CACHE_CONFIGURATION } from './AbstractRedisCache'

export class RedisCache<T> extends AbstractRedisCache<RedisCacheConfiguration, T> implements Cache<T>, DataSource<T> {
  public readonly expirationTimeLoadingOperation: Loader<number>
  public readonly ttlLeftBeforeRefreshInMsecs?: number
  name = 'Redis cache'

  constructor(redis: Redis, config: Partial<RedisCacheConfiguration> = DEFAULT_REDIS_CACHE_CONFIGURATION) {
    super(redis, config)
    this.ttlLeftBeforeRefreshInMsecs = config.ttlLeftBeforeRefreshInMsecs

    if (!this.ttlLeftBeforeRefreshInMsecs && config.ttlCacheTtl) {
      throw new Error('ttlCacheTtl cannot be specified if ttlLeftBeforeRefreshInMsecs is not.')
    }

    this.expirationTimeLoadingOperation = new Loader<number>({
      inMemoryCache: config.ttlCacheTtl
        ? {
            cacheId: 'ttl-cache',
            ttlInMsecs: config.ttlCacheTtl,
            maxItems: config.ttlCacheSize ?? 500,
          }
        : undefined,
      dataSources: [new RedisExpirationTimeDataSource(this)],
    })
  }

  delete(key: string): Promise<unknown> {
    return this.redis.del(this.resolveKey(key))
  }

  get(key: string): Promise<T | undefined> {
    return this.redis.get(this.resolveKey(key)).then((redisResult) => {
      return this.postprocessResult(redisResult)
    })
  }

  getExpirationTime(key: string): Promise<number | undefined> {
    const now = Date.now()

    return this.executeWithTimeout(this.redis.pttl(this.resolveKey(key))).then((remainingTtl) => {
      return remainingTtl && remainingTtl > 0 ? now + remainingTtl : undefined
    })
  }

  set(key: string, value: T | null): Promise<void> {
    return this.internalSet(this.resolveKey(key), value).then(() => {
      if (this.ttlLeftBeforeRefreshInMsecs) {
        void this.expirationTimeLoadingOperation.invalidateCacheFor(key)
      }
    })
  }
}
