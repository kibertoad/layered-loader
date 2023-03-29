import { Cache, CacheConfiguration, GroupedCache, Loader } from '../types/DataSources'
import type { Redis } from 'ioredis'
import { RedisTimeoutError } from './RedisTimeoutError'
import { GET_OR_SET_ZERO_WITH_TTL, GET_OR_SET_ZERO_WITHOUT_TTL } from './lua'

const TIMEOUT = Symbol()
const GROUP_INDEX_KEY = 'group-index'

export interface RedisCacheConfiguration extends CacheConfiguration {
  prefix: string
  json: boolean
  timeoutInMsecs?: number
  separator?: string
  groupTtlInMsecs?: number
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
  public readonly ttlLeftBeforeRefreshInMsecs?: number
  name = 'Redis cache'
  isCache = true

  constructor(redis: Redis, config: Partial<RedisCacheConfiguration> = DefaultConfiguration) {
    this.redis = redis
    this.config = {
      ...DefaultConfiguration,
      ...config,
    }
    this.ttlLeftBeforeRefreshInMsecs = config.ttlLeftBeforeRefreshInMsecs
    this.redis.defineCommand('getOrSetZeroWithTtl', {
      lua: GET_OR_SET_ZERO_WITH_TTL,
      numberOfKeys: 1,
    })
    this.redis.defineCommand('getOrSetZeroWithoutTtl', {
      lua: GET_OR_SET_ZERO_WITHOUT_TTL,
      numberOfKeys: 1,
    })
  }

  private executeWithTimeout<T>(originalPromise: Promise<T>): Promise<T> {
    if (!this.config.timeoutInMsecs) {
      return originalPromise
    }

    let storedReject: any
    let storedTimeout: any
    const timeout = new Promise((resolve, reject) => {
      storedReject = reject
      storedTimeout = setTimeout(resolve, this.config.timeoutInMsecs, TIMEOUT)
    })
    return Promise.race([timeout, originalPromise]).then((result) => {
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
    })
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
    const key = this.resolveGroupIndexPrefix(group)
    if (this.config.ttlInMsecs) {
      await this.redis.multi().incr(key).pexpire(key, this.config.ttlInMsecs).exec()
      return
    }

    return this.redis.incr(key)
  }

  async deleteFromGroup(key: string, group: string): Promise<void> {
    const currentGroupKey = await this.executeWithTimeout(this.redis.get(this.resolveGroupIndexPrefix(group)))
    if (!currentGroupKey) {
      return
    }
    await this.executeWithTimeout(this.redis.del(this.resolveKeyWithGroup(key, group, currentGroupKey)))
  }

  delete(key: string): Promise<unknown> {
    return this.executeWithTimeout(this.redis.del(this.resolveKey(key)))
  }

  async getFromGroup(key: string, groupId: string): Promise<T | undefined | null> {
    const currentGroupKey = await this.executeWithTimeout(this.redis.get(this.resolveGroupIndexPrefix(groupId)))
    if (!currentGroupKey) {
      return undefined
    }

    const redisResult = await this.executeWithTimeout(
      this.redis.get(this.resolveKeyWithGroup(key, groupId, currentGroupKey))
    )
    return this.postprocessResult(redisResult)
  }

  get(key: string): Promise<T | undefined> {
    return this.executeWithTimeout(this.redis.get(this.resolveKey(key))).then((redisResult) => {
      return this.postprocessResult(redisResult)
    })
  }

  getExpirationTime(key: string): Promise<number | undefined> {
    const now = Date.now()

    return this.executeWithTimeout(this.redis.pttl(this.resolveKey(key))).then((remainingTtl) => {
      return remainingTtl && remainingTtl > 0 ? now + remainingTtl : undefined
    })
  }

  async getExpirationTimeFromGroup(key: string, groupId: string): Promise<number | undefined> {
    const now = Date.now()

    const currentGroupKey = await this.executeWithTimeout(this.redis.get(this.resolveGroupIndexPrefix(groupId)))
    if (currentGroupKey === null) {
      return undefined
    }

    const remainingTtl = await this.executeWithTimeout(
      this.redis.pttl(this.resolveKeyWithGroup(key, groupId, currentGroupKey))
    )
    return remainingTtl && remainingTtl > 0 ? now + remainingTtl : undefined
  }

  set(key: string, value: T | null): Promise<unknown> {
    return this.internalSet(this.resolveKey(key), value)
  }

  async setForGroup(key: string, value: T | null, groupId: string): Promise<void> {
    const getGroupKeyPromise = this.config.groupTtlInMsecs
      ? // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.redis.getOrSetZeroWithTtl(this.resolveGroupIndexPrefix(groupId), this.config.groupTtlInMsecs)
      : // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.redis.getOrSetZeroWithoutTtl(this.resolveGroupIndexPrefix(groupId))

    const currentGroupKey = await this.executeWithTimeout<string>(getGroupKeyPromise)

    const entryKey = this.resolveKeyWithGroup(key, groupId, currentGroupKey)
    await this.internalSet(entryKey, value)
  }

  private internalSet(resolvedKey: string, value: T | null) {
    const resolvedValue: string = value && this.config.json ? JSON.stringify(value) : (value as unknown as string)
    if (this.config.ttlInMsecs) {
      return this.executeWithTimeout(this.redis.set(resolvedKey, resolvedValue, 'PX', this.config.ttlInMsecs))
    }
    return this.executeWithTimeout(this.redis.set(resolvedKey, resolvedValue))
  }

  resolveKey(key: string) {
    return `${this.config.prefix}${this.config.separator}${key}`
  }

  resolveKeyWithGroup(key: string, groupId: string, groupIndexKey: string) {
    return `${this.config.prefix}${this.config.separator}${groupId}${this.config.separator}${groupIndexKey}${this.config.separator}${key}`
  }

  resolveCachePattern() {
    return `${this.config.prefix}${this.config.separator}*`
  }

  resolveGroupIndexPrefix(groupId: string) {
    return `${this.config.prefix}${this.config.separator}${GROUP_INDEX_KEY}${this.config.separator}${groupId}`
  }
}
