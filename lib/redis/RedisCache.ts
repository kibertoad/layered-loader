import {Cache, CacheConfiguration, KeyConfiguration, Loader} from '../DataSources'
import type { Redis } from 'ioredis'
import { RedisTimeoutError } from './RedisTimeoutError'

const TIMEOUT = Symbol()

export interface RedisCacheConfiguration extends CacheConfiguration {
  prefix: string
  json: boolean
  timeout?: number
}

const DefaultConfiguration: RedisCacheConfiguration = {
  json: false,
  prefix: 'layered-cache:',
  ttlInMsecs: 1000 * 60 * 10,
}

export class RedisCache<T> implements Cache<T>, Loader<T> {
  private readonly redis: Redis
  private readonly config: RedisCacheConfiguration
  name = 'Redis cache'
  isCache = true

  constructor(redis: Redis, config: RedisCacheConfiguration = DefaultConfiguration) {
    this.redis = redis
    this.config = config
  }

  private async executeWithTimeout<T>(originalPromise: Promise<T>): Promise<T> {
    if (!this.config.timeout) {
      return originalPromise
    }

    let storedReject: (reason?: any) => void
    let storedTimeout: any
    const timeout = new Promise((resolve, reject) => {
      storedReject = reject
      storedTimeout = setTimeout(resolve, this.config.timeout, TIMEOUT)
    })
    const result = await Promise.race([timeout, originalPromise])

    if (result === TIMEOUT) {
      throw new RedisTimeoutError()
    }

    if (storedReject) {
      storedReject(undefined)
      clearTimeout(storedTimeout)
    }
    return result as T
  }

  async clear(): Promise<void> {
    await this.executeWithTimeout(this.redis.flushdb())
  }

  async delete(key: string, config?: KeyConfiguration): Promise<void> {
    if (!config?.group) {
      await this.executeWithTimeout(this.redis.del(this.resolveKey(key)))
    } else {
      const itemsInGroup = await this.executeWithTimeout(this.redis.keys(this.resolveKeyGroupPattern(config.group)))
      await this.executeWithTimeout(this.redis.del(itemsInGroup))
    }
  }

  async get(key: string, config?: KeyConfiguration): Promise<T | undefined> {
    const redisResult = await this.executeWithTimeout(this.redis.get(this.resolveKey(key, config?.group)))
    if (redisResult && this.config.json) {
      return JSON.parse(redisResult)
    }

    // Redis returns "null" for unknown values
    // ToDo We should create some fictional value for explicitly null values for redis
    if (redisResult === null) {
      return undefined
    }

    return redisResult as unknown as T
  }

  async set(key: string, value: T | null, config?: CacheConfiguration): Promise<void> {
    const resolvedValue: string = value && this.config.json ? JSON.stringify(value) : (value as unknown as string)

    if (this.config.ttlInMsecs) {
      await this.executeWithTimeout(this.redis.set(this.resolveKey(key, config?.group), resolvedValue, 'PX', this.config.ttlInMsecs))
      return
    }
    await this.executeWithTimeout(this.redis.set(this.resolveKey(key, config?.group), resolvedValue))
  }

  resolveKey(key: string, group = '') {
    return `${this.config.prefix}${group}${key}`
  }

  resolveKeyGroupPattern(group: string) {
    return `${this.config.prefix}${group}*`
  }
}
