import { Cache, CacheConfiguration, GroupedCache, Loader } from '../DataSources'
import type { Redis } from 'ioredis'
import { RedisTimeoutError } from './RedisTimeoutError'
import { SET_GROUP_INDEX_ATOMIC_SCRIPT } from './lua'

const TIMEOUT = Symbol()
const GROUP_INDEX_KEY = 'group-index'

export interface RedisCacheConfiguration extends CacheConfiguration {
  prefix: string
  json: boolean
  timeout?: number
  separator?: string
}

const DefaultConfiguration: RedisCacheConfiguration = {
  json: false,
  prefix: 'layered-cache:',
  ttlInMsecs: 1000 * 60 * 10,
  separator: ':',
}

export class RedisCache<T> implements GroupedCache<T>, Cache<T>, Loader<T> {
  private readonly redis: Redis
  private readonly config: RedisCacheConfiguration
  name = 'Redis cache'
  isCache = true

  constructor(redis: Redis, config: Partial<RedisCacheConfiguration> = DefaultConfiguration) {
    this.redis = redis
    this.config = {
      ...DefaultConfiguration,
      ...config,
    }
    this.redis.defineCommand('getGroupIndexAtomic', {
      lua: SET_GROUP_INDEX_ATOMIC_SCRIPT,
      numberOfKeys: 1,
    })
  }

  private async executeWithTimeout<T>(originalPromise: Promise<T>): Promise<T> {
    if (!this.config.timeout) {
      return originalPromise
    }

    let storedReject = null
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
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      storedReject(undefined)
      clearTimeout(storedTimeout)
    }
    return result as T
  }

  private postprocessResult(redisResult: string | null) {
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

  async clear(): Promise<void> {
    const pattern = this.resolveCachePattern()
    let cursor = '0'
    do {
      const scanResults = await this.executeWithTimeout(this.redis.scan(cursor, 'MATCH', pattern))

      cursor = scanResults[0]
      if (scanResults[1].length > 0) {
        await this.executeWithTimeout(this.redis.del(scanResults[1]))
      }
    } while (cursor !== '0')
  }

  async deleteGroup(group: string) {
    await this.redis.incr(this.resolveGroupIndexPrefix(group))
  }

  async delete(key: string): Promise<void> {
    await this.executeWithTimeout(this.redis.del(this.resolveKey(key)))
  }

  async getFromGroup(key: string, group: string): Promise<T | undefined | null> {
    const currentGroupKey = await this.executeWithTimeout(this.redis.get(this.resolveGroupIndexPrefix(group)))
    if (!currentGroupKey) {
      return undefined
    }

    const redisResult = await this.executeWithTimeout(
      this.redis.get(this.resolveKeyWithGroup(key, group, currentGroupKey))
    )
    return this.postprocessResult(redisResult)
  }

  async get(key: string): Promise<T | undefined> {
    const redisResult = await this.executeWithTimeout(this.redis.get(this.resolveKey(key)))
    return this.postprocessResult(redisResult)
  }

  async set(key: string, value: T | null): Promise<void> {
    await this.internalSet(this.resolveKey(key), value)
  }

  async setForGroup(key: string, value: T | null, group: string): Promise<void> {
    const currentGroupKey = await this.executeWithTimeout<string>(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      this.redis.getGroupIndexAtomic(this.resolveGroupIndexPrefix(group), this.config.ttlInMsecs)
    )

    const entryKey = this.resolveKeyWithGroup(key, group, currentGroupKey)
    await this.internalSet(entryKey, value)
  }

  private async internalSet(resolvedKey: string, value: T | null) {
    const resolvedValue: string = value && this.config.json ? JSON.stringify(value) : (value as unknown as string)
    if (this.config.ttlInMsecs) {
      await this.executeWithTimeout(this.redis.set(resolvedKey, resolvedValue, 'PX', this.config.ttlInMsecs))
      return
    }
    await this.executeWithTimeout(this.redis.set(resolvedKey, resolvedValue))
  }

  resolveKey(key: string) {
    return `${this.config.prefix}${this.config.separator}${key}`
  }

  resolveKeyWithGroup(key: string, group: string, groupIndexKey: string) {
    return `${this.config.prefix}${this.config.separator}${group}${this.config.separator}${groupIndexKey}${this.config.separator}${key}`
  }

  resolveCachePattern() {
    return `${this.config.prefix}${this.config.separator}*`
  }

  resolveGroupIndexPrefix(group: string) {
    return `${this.config.prefix}${this.config.separator}${GROUP_INDEX_KEY}${this.config.separator}${group}`
  }
}
