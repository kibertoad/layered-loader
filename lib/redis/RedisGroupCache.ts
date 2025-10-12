import type Redis from 'ioredis'
import { GroupLoader } from '../GroupLoader'
import type { CacheEntry, GroupCache, GroupCacheConfiguration } from '../types/DataSources'
import type { GetManyResult } from '../types/SyncDataSources'
import type { RedisCacheConfiguration } from './AbstractRedisCache'
import { AbstractRedisCache } from './AbstractRedisCache'
import { GET_OR_SET_ZERO_WITHOUT_TTL, GET_OR_SET_ZERO_WITH_TTL } from './lua'
import type { RedisClientType } from './RedisClientAdapter'
import { isIoRedisClient } from './RedisClientAdapter'
import { RedisExpirationTimeGroupDataSource } from './RedisExpirationTimeGroupDataSource'

const GROUP_INDEX_KEY = 'group-index'

export interface RedisGroupCacheConfiguration extends RedisCacheConfiguration, GroupCacheConfiguration {
  groupTtlInMsecs?: number
}

/**
 * RedisGroupCache uses advanced Redis operations (Lua scripts, transactions).
 * Now uses adapter invokeScript() method for cross-client compatibility.
 */
export class RedisGroupCache<T> extends AbstractRedisCache<RedisGroupCacheConfiguration, T> implements GroupCache<T> {
  public readonly expirationTimeLoadingGroupedOperation: GroupLoader<number>
  public ttlLeftBeforeRefreshInMsecs?: number
  name = 'Redis group cache'

  constructor(redis: RedisClientType, config: Partial<RedisGroupCacheConfiguration> = {}) {
    super(redis, config)

    this.ttlLeftBeforeRefreshInMsecs = config.ttlLeftBeforeRefreshInMsecs

    if (!this.ttlLeftBeforeRefreshInMsecs && config.ttlCacheTtl) {
      throw new Error('ttlCacheTtl cannot be specified if ttlLeftBeforeRefreshInMsecs is not.')
    }

    this.expirationTimeLoadingGroupedOperation = new GroupLoader<number>({
      inMemoryCache: config.ttlCacheTtl
        ? {
            cacheId: 'expiration-time-loading-cache',
            ttlInMsecs: config.ttlCacheTtl,
            maxGroups: config.ttlCacheGroupSize ?? 200,
            maxItemsPerGroup: config.ttlCacheSize ?? 500,
          }
        : undefined,
      dataSources: [new RedisExpirationTimeGroupDataSource(this)],
    })
  }

  async deleteGroup(group: string) {
    const key = this.resolveGroupIndexPrefix(group)
    
    // For ioredis with TTL, use multi for transactions (micro-optimization)
    if (this.config.ttlInMsecs && isIoRedisClient(this.redis.getUnderlyingClient())) {
      const ioredis = this.redis.getUnderlyingClient() as Redis
      await ioredis.multi().incr(key).pexpire(key, this.config.ttlInMsecs).exec()
      return
    }
    
    // For TTL case, need atomic operation - use Lua script
    if (this.config.ttlInMsecs) {
      const script = `
        redis.call('INCR', KEYS[1])
        redis.call('PEXPIRE', KEYS[1], ARGV[1])
        return 1
      `
      await this.redis.invokeScript(script, [key], [this.config.ttlInMsecs.toString()])
      return
    }
    
    // No TTL case - use native incr if available (both clients support it)
    if (this.redis.incr) {
      await this.redis.incr(key)
      return
    }
    
    // Fallback to Lua script (should not happen with modern adapters)
    const script = `return redis.call('INCR', KEYS[1])`
    return this.redis.invokeScript(script, [key], [])
  }

  async deleteFromGroup(key: string, group: string): Promise<void> {
    const currentGroupKey = await this.redis.get(this.resolveGroupIndexPrefix(group))
    if (!currentGroupKey) {
      return
    }
    await this.redis.del(this.resolveKeyWithGroup(key, group, currentGroupKey))
  }

  async getFromGroup(key: string, groupId: string): Promise<T | undefined | null> {
    const currentGroupKey = await this.redis.get(this.resolveGroupIndexPrefix(groupId))
    if (!currentGroupKey) {
      return undefined
    }

    const redisResult = await this.redis.get(this.resolveKeyWithGroup(key, groupId, currentGroupKey))
    return this.postprocessResult(redisResult)
  }

  async getManyFromGroup(keys: string[], groupId: string): Promise<GetManyResult<T>> {
    const currentGroupKey = await this.redis.get(this.resolveGroupIndexPrefix(groupId))
    if (!currentGroupKey) {
      return {
        resolvedValues: [],
        unresolvedKeys: keys,
      }
    }

    const transformedKeys = keys.map((key) => this.resolveKeyWithGroup(key, groupId, currentGroupKey))
    const resolvedValues: T[] = []
    const unresolvedKeys: string[] = []

    return this.redis.mget(transformedKeys).then((redisResult: (string | null)[]) => {
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

  async getExpirationTimeFromGroup(key: string, groupId: string): Promise<number | undefined> {
    const now = Date.now()

    const currentGroupKey = await this.redis.get(this.resolveGroupIndexPrefix(groupId))
    if (currentGroupKey === null) {
      return undefined
    }

    const remainingTtl = await this.redis.pttl(this.resolveKeyWithGroup(key, groupId, currentGroupKey))
    return remainingTtl && remainingTtl > 0 ? now + remainingTtl : undefined
  }

  async setForGroup(key: string, value: T | null, groupId: string): Promise<void> {
    // Use adapter's invokeScript for Lua script execution
    const script = this.config.groupTtlInMsecs ? GET_OR_SET_ZERO_WITH_TTL : GET_OR_SET_ZERO_WITHOUT_TTL
    const args = this.config.groupTtlInMsecs ? [this.config.groupTtlInMsecs.toString()] : []
    
    const currentGroupKey = await this.redis.invokeScript(
      script,
      [this.resolveGroupIndexPrefix(groupId)],
      args
    )

    const entryKey = this.resolveKeyWithGroup(key, groupId, currentGroupKey)
    await this.internalSet(entryKey, value)
    if (this.ttlLeftBeforeRefreshInMsecs) {
      void this.expirationTimeLoadingGroupedOperation.invalidateCacheFor(key, groupId)
    }
  }

  async setManyForGroup(entries: readonly CacheEntry<T>[], groupId: string): Promise<unknown> {
    // Use adapter's invokeScript for Lua script execution
    const script = this.config.groupTtlInMsecs ? GET_OR_SET_ZERO_WITH_TTL : GET_OR_SET_ZERO_WITHOUT_TTL
    const args = this.config.groupTtlInMsecs ? [this.config.groupTtlInMsecs.toString()] : []
    
    const currentGroupKey = await this.redis.invokeScript(
      script,
      [this.resolveGroupIndexPrefix(groupId)],
      args
    )

    if (this.config.ttlInMsecs && isIoRedisClient(this.redis.getUnderlyingClient())) {
      // Use ioredis multi for batch set with TTL
      const ioredis = this.redis.getUnderlyingClient() as Redis
      const setCommands = []
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        setCommands.push([
          'set',
          this.resolveKeyWithGroup(entry.key, groupId, currentGroupKey),
          entry.value && this.config.json ? JSON.stringify(entry.value) : entry.value,
          'PX',
          this.config.ttlInMsecs,
        ])
      }

      return ioredis.multi(setCommands).exec()
    }
    
    if (this.config.ttlInMsecs) {
      // For valkey-glide with TTL, set each entry individually (no multi support)
      const promises = []
      for (const entry of entries) {
        const key = this.resolveKeyWithGroup(entry.key, groupId, currentGroupKey)
        const value = entry.value && this.config.json ? JSON.stringify(entry.value) : (entry.value as unknown as string)
        promises.push(this.redis.set(key, value, 'PX', this.config.ttlInMsecs))
      }
      return Promise.all(promises)
    }

    // No TTL set - use mset with Record format for adapter compatibility
    const keyValueObj: Record<string, string> = {}
    for (const entry of entries) {
      const key = this.resolveKeyWithGroup(entry.key, groupId, currentGroupKey)
      const value = entry.value && this.config.json ? JSON.stringify(entry.value) : (entry.value as unknown as string)
      keyValueObj[key] = value
    }
    return this.redis.mset(keyValueObj)
  }

  resolveKeyWithGroup(key: string, groupId: string, groupIndexKey: string) {
    return `${this.config.prefix}${this.config.separator}${groupId}${this.config.separator}${groupIndexKey}${this.config.separator}${key}`
  }

  resolveGroupIndexPrefix(groupId: string) {
    return `${this.config.prefix}${this.config.separator}${GROUP_INDEX_KEY}${this.config.separator}${groupId}`
  }

  async close() {
    // prevent refreshes after everything is shutting down to prevent "Error: Connection is closed." errors
    this.ttlLeftBeforeRefreshInMsecs = 0
  }
}
