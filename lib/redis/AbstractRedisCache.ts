import type { Redis } from 'ioredis'
import type { CommonCacheConfiguration } from '../types/DataSources'

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
  protected readonly redis: Redis
  protected readonly config: ConfigType

  constructor(redis: Redis, config: Partial<ConfigType>) {
    this.redis = redis
    // @ts-ignore
    this.config = {
      ...DEFAULT_REDIS_CACHE_CONFIGURATION,
      ...config,
    }
  }

  protected internalSet(resolvedKey: string, value: LoadedValue | null) {
    const resolvedValue: string = value && this.config.json ? JSON.stringify(value) : (value as unknown as string)
    if (this.config.ttlInMsecs) {
      return this.redis.set(resolvedKey, resolvedValue, 'PX', this.config.ttlInMsecs)
    }
    return this.redis.set(resolvedKey, resolvedValue)
  }

  protected postprocessResult(redisResult: string | null) {
    if (redisResult && this.config.json) {
      return JSON.parse(redisResult)
    }

    // Redis returns "null" for unknown values
    // ToDo We should create some fictional value for explicitly null values for redis
    if (redisResult === null) {
      return undefined
    }

    return redisResult as unknown as ConfigType
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
    return `${this.config.prefix}${this.config.separator}${key}`
  }

  resolveCachePattern() {
    return `${this.config.prefix}${this.config.separator}*`
  }
}
