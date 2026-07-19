import type { Redis } from 'ioredis'
import { GroupLoader } from '../GroupLoader.js'
import type { CacheEntry, GroupCache, GroupCacheConfiguration } from '../types/DataSources.js'
import type { GetManyResult } from '../types/SyncDataSources.js'
import type { RedisCacheConfiguration } from './AbstractRedisCache.js'
import { AbstractRedisCache } from './AbstractRedisCache.js'
import { RedisExpirationTimeGroupDataSource } from './RedisExpirationTimeGroupDataSource.js'
import { GET_OR_SET_ZERO_WITHOUT_TTL, GET_OR_SET_ZERO_WITH_TTL } from './lua.js'

const GROUP_INDEX_KEY = 'group-index'

export interface RedisGroupCacheConfiguration extends RedisCacheConfiguration, GroupCacheConfiguration {
  groupTtlInMsecs?: number
}

export class RedisGroupCache<T> extends AbstractRedisCache<RedisGroupCacheConfiguration, T> implements GroupCache<T> {
  public readonly expirationTimeLoadingGroupedOperation: GroupLoader<number>
  public ttlLeftBeforeRefreshInMsecs?: number
  private readonly groupIndexPrefix: string
  name = 'Redis group cache'

  constructor(redis: Redis, config: Partial<RedisGroupCacheConfiguration> = {}) {
    super(redis, config)

    this.groupIndexPrefix = `${this.keyPrefix}${GROUP_INDEX_KEY}${this.config.separator}`

    this.ttlLeftBeforeRefreshInMsecs = config.ttlLeftBeforeRefreshInMsecs
    this.redis.defineCommand('getOrSetZeroWithTtl', {
      lua: GET_OR_SET_ZERO_WITH_TTL,
      numberOfKeys: 1,
    })
    this.redis.defineCommand('getOrSetZeroWithoutTtl', {
      lua: GET_OR_SET_ZERO_WITHOUT_TTL,
      numberOfKeys: 1,
    })

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
    // the group index key's lifetime is governed by groupTtlInMsecs everywhere else
    // (see setForGroup/setManyForGroup); using entry ttlInMsecs here would silently
    // re-scope the generation counter to the entry TTL
    if (this.config.groupTtlInMsecs) {
      await this.redis.multi().incr(key).pexpire(key, this.config.groupTtlInMsecs).exec()
      return
    }

    return this.redis.incr(key)
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

    const entryPrefix = this.resolveGroupEntryPrefix(groupId, currentGroupKey)
    const transformedKeys = keys.map((key) => entryPrefix + key)
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

  async getExpirationTimeFromGroup(key: string, groupId: string): Promise<number | undefined> {
    const now = Date.now()

    const currentGroupKey = await this.redis.get(this.resolveGroupIndexPrefix(groupId))
    if (currentGroupKey === null) {
      return undefined
    }

    const remainingTtl = await this.redis.pttl(this.resolveKeyWithGroup(key, groupId, currentGroupKey))
    return remainingTtl && remainingTtl > 0 ? now + remainingTtl : undefined
  }

  async resetTtlFromGroup(key: string, groupId: string): Promise<boolean> {
    // without a TTL entries never expire, so there is nothing to reset
    if (!this.config.ttlInMsecs) {
      return false
    }

    // a missing group index means the group was invalidated - the entry is effectively gone
    const currentGroupKey = await this.redis.get(this.resolveGroupIndexPrefix(groupId))
    if (!currentGroupKey) {
      return false
    }

    const result = await this.redis.pexpire(
      this.resolveKeyWithGroup(key, groupId, currentGroupKey),
      this.config.ttlInMsecs,
    )
    // 0 means the key no longer exists - it expired or was deleted since it was read
    if (result !== 1) {
      return false
    }
    if (this.ttlLeftBeforeRefreshInMsecs) {
      // warm the cached expiration time with the value we just set (see RedisCache.resetTtl)
      void this.expirationTimeLoadingGroupedOperation.forceSetValueForGroup(
        key,
        Date.now() + this.config.ttlInMsecs!,
        groupId,
      )
    }
    return true
  }

  async setForGroup(key: string, value: T | null, groupId: string): Promise<void> {
    const getGroupKeyPromise = this.config.groupTtlInMsecs
      ? // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.redis.getOrSetZeroWithTtl(this.resolveGroupIndexPrefix(groupId), this.config.groupTtlInMsecs)
      : // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.redis.getOrSetZeroWithoutTtl(this.resolveGroupIndexPrefix(groupId))

    const currentGroupKey = await getGroupKeyPromise

    const entryKey = this.resolveKeyWithGroup(key, groupId, currentGroupKey)
    await this.internalSet(entryKey, value)
    if (this.ttlLeftBeforeRefreshInMsecs) {
      void this.expirationTimeLoadingGroupedOperation.invalidateCacheFor(key, groupId)
    }
  }

  async setManyForGroup(entries: readonly CacheEntry<T>[], groupId: string): Promise<unknown> {
    const getGroupKeyPromise = this.config.groupTtlInMsecs
      ? // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.redis.getOrSetZeroWithTtl(this.resolveGroupIndexPrefix(groupId), this.config.groupTtlInMsecs)
      : // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.redis.getOrSetZeroWithoutTtl(this.resolveGroupIndexPrefix(groupId))

    const currentGroupKey = await getGroupKeyPromise

    const entryPrefix = this.resolveGroupEntryPrefix(groupId, currentGroupKey)
    if (this.config.ttlInMsecs) {
      const setCommands = []
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        setCommands.push([
          'set',
          entryPrefix + entry.key,
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
      commandParam.push(entryPrefix + entry.key)
      commandParam.push(entry.value && this.config.json ? JSON.stringify(entry.value) : entry.value)
    }
    return this.redis.mset(commandParam)
  }

  resolveKeyWithGroup(key: string, groupId: string, groupIndexKey: string) {
    return this.resolveGroupEntryPrefix(groupId, groupIndexKey) + key
  }

  private resolveGroupEntryPrefix(groupId: string, groupIndexKey: string) {
    return `${this.keyPrefix}${groupId}${this.config.separator}${groupIndexKey}${this.config.separator}`
  }

  resolveGroupIndexPrefix(groupId: string) {
    return this.groupIndexPrefix + groupId
  }

  async close() {
    // prevent refreshes after everything is shutting down to prevent "Error: Connection is closed." errors
    this.ttlLeftBeforeRefreshInMsecs = 0
  }
}
