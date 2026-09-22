import type { RedisLike } from './RedisLike.js'
import type { CommonCacheConfiguration } from '../types/DataSources.js'

export interface RedisCacheConfiguration extends CommonCacheConfiguration {
  prefix: string
  json: boolean
  timeoutInMsecs?: number
  separator?: string
}

export const DEFAULT_REDIS_CACHE_CONFIGURATION: RedisCacheConfiguration = {
  json: false,
  prefix: 'layered-cache',
  ttlInMsecs: 1000 * 60 * 10,
  separator: ':',
}

export abstract class AbstractRedisCache<ConfigType extends RedisCacheConfiguration, LoadedValue> {
  protected readonly redis: RedisLike
  protected readonly config: ConfigType
  protected readonly keyPrefix: string

  constructor(redis: RedisLike, config: Partial<ConfigType>) {
    this.redis = redis
    // @ts-ignore
    this.config = {
      ...DEFAULT_REDIS_CACHE_CONFIGURATION,
      ...config,
    }
    this.keyPrefix = `${this.config.prefix}${this.config.separator}`
  }

  protected internalSet(resolvedKey: string, value: LoadedValue | null) {
    const resolvedValue: string = this.config.json ? JSON.stringify(value) : (value as unknown as string)
    if (this.config.ttlInMsecs) {
      return this.redis.set(resolvedKey, resolvedValue, 'PX', this.config.ttlInMsecs)
    }
    return this.redis.set(resolvedKey, resolvedValue)
  }

  protected postprocessResult(redisResult: string): LoadedValue | null
  protected postprocessResult(redisResult: string | null): LoadedValue | null | undefined
  protected postprocessResult(redisResult: string | null): LoadedValue | null | undefined {
    // keep the truthiness check: JSON.parse('') throws, and older versions stored null as ''
    if (redisResult && this.config.json) {
      return JSON.parse(redisResult)
    }

    // A missing key is a miss; an explicitly cached null is only distinguishable with json: true
    if (redisResult === null) {
      return undefined
    }

    return redisResult as unknown as LoadedValue
  }

  async clear(): Promise<void> {
    const pattern = this.resolveCachePattern()
    let cursor = '0'
    do {
      const scanResults = await this.redis.scan(cursor, 'MATCH', pattern)

      cursor = scanResults[0]
      if (scanResults[1].length > 0) {
        await this.redis.del(scanResults[1])
      }
    } while (cursor !== '0')
  }

  resolveKey(key: string) {
    return this.keyPrefix + key
  }

  resolveCachePattern() {
    return `${this.keyPrefix}*`
  }
}
