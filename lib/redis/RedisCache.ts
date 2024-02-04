import type Redis from 'ioredis'
import { Loader } from '../Loader'
import type { Cache, CacheEntry } from '../types/DataSources'
import type { GetManyResult } from '../types/SyncDataSources'
import type { RedisCacheConfiguration } from './AbstractRedisCache'
import { AbstractRedisCache, DEFAULT_REDIS_CACHE_CONFIGURATION } from './AbstractRedisCache'
import { RedisExpirationTimeDataSource } from './RedisExpirationTimeDataSource'

export class RedisCache<T> extends AbstractRedisCache<RedisCacheConfiguration, T> implements Cache<T> {
  public readonly expirationTimeLoadingOperation: Loader<number>
  public ttlLeftBeforeRefreshInMsecs?: number
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

  deleteMany(keys: string[]): Promise<unknown> {
    const processedKeys = keys.map((key) => {
      return this.resolveKey(key)
    })
    return this.redis.del(processedKeys)
  }

  get(key: string): Promise<T | undefined> {
    return this.redis.get(this.resolveKey(key)).then((redisResult) => {
      return this.postprocessResult(redisResult)
    })
  }

  getMany(keys: string[]): Promise<GetManyResult<T>> {
    const transformedKeys = keys.map((entry) => this.resolveKey(entry))
    const resolvedValues: T[] = []
    const unresolvedKeys: string[] = []

    return this.redis.mget(transformedKeys).then((redisResult) => {
      for (let i = 0; i < keys.length; i++) {
        const currentResult = redisResult[i]

        if (currentResult !== null) {
          resolvedValues.push(this.postprocessResult(currentResult))
        } else {
          unresolvedKeys.push(keys[i])
        }
      }

      return {
        resolvedValues,
        unresolvedKeys,
      }
    })
  }

  getExpirationTime(key: string): Promise<number | undefined> {
    const now = Date.now()

    return this.redis.pttl(this.resolveKey(key)).then((remainingTtl) => {
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

  setMany(entries: readonly CacheEntry<T>[]): Promise<unknown> {
    if (this.config.ttlInMsecs) {
      const setCommands = []
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        setCommands.push([
          'set',
          this.resolveKey(entry.key),
          entry.value && this.config.json ? JSON.stringify(entry.value) : entry.value,
          'PX',
          this.config.ttlInMsecs,
        ])
      }

      return this.redis.multi(setCommands).exec()
    }

    // No TTL set
    const commandParam = []
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      commandParam.push(this.resolveKey(entry.key))
      commandParam.push(entry.value && this.config.json ? JSON.stringify(entry.value) : entry.value)
    }
    return this.redis.mset(commandParam)
  }

  async close() {
    // prevent refreshes after everything is shutting down to prevent "Error: Connection is closed." errors
    this.ttlLeftBeforeRefreshInMsecs = 0
  }
}
