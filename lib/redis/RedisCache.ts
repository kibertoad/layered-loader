import { Loader } from '../Loader'
import type { Cache, CacheEntry } from '../types/DataSources'
import type { GetManyResult } from '../types/SyncDataSources'
import type { RedisCacheConfiguration } from './AbstractRedisCache'
import { AbstractRedisCache, DEFAULT_REDIS_CACHE_CONFIGURATION } from './AbstractRedisCache'
import type { RedisClientType } from './RedisClientAdapter'
import { RedisExpirationTimeDataSource } from './RedisExpirationTimeDataSource'

export class RedisCache<T> extends AbstractRedisCache<RedisCacheConfiguration, T> implements Cache<T> {
  public readonly expirationTimeLoadingOperation: Loader<number>
  public ttlLeftBeforeRefreshInMsecs?: number
  name = 'Redis cache'

  constructor(redis: RedisClientType, config: Partial<RedisCacheConfiguration> = DEFAULT_REDIS_CACHE_CONFIGURATION) {
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

    return this.redis.pttl(this.resolveKey(key)).then((remainingTtl: number) => {
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

  async setMany(entries: readonly CacheEntry<T>[]): Promise<unknown> {
    if (this.config.ttlInMsecs) {
      // Use multi/batch if available (both ioredis and valkey-glide support it)
      if (this.redis.multi) {
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

        // Await the multi execution result
        const result = await this.redis.multi(setCommands)
        
        // Invalidate expiration cache for each entry if TTL refresh is configured
        if (this.ttlLeftBeforeRefreshInMsecs) {
          for (const entry of entries) {
            void this.expirationTimeLoadingOperation.invalidateCacheFor(entry.key)
          }
        }
        
        return result
      }
      
      // Fallback for clients without multi support
      const promises = []
      for (const entry of entries) {
        promises.push(this.set(entry.key, entry.value))
      }
      return Promise.all(promises)
    }

    // No TTL set - use mset with flat array [key, value, key, value, ...]
    const keyValueArray: string[] = []
    for (const entry of entries) {
      const key = this.resolveKey(entry.key)
      const value = entry.value && this.config.json ? JSON.stringify(entry.value) : (entry.value as unknown as string)
      keyValueArray.push(key, value)
    }
    return this.redis.mset(keyValueArray)
  }

  async close() {
    // prevent refreshes after everything is shutting down to prevent "Error: Connection is closed." errors
    this.ttlLeftBeforeRefreshInMsecs = 0
  }
}
