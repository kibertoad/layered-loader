import type { GroupCache, GroupCacheConfiguration, GroupDataSource } from '../types/DataSources'
import type Redis from 'ioredis'
import { GET_OR_SET_ZERO_WITH_TTL, GET_OR_SET_ZERO_WITHOUT_TTL } from './lua'
import { GroupLoader } from '../GroupLoader'
import { RedisExpirationTimeGroupDataSource } from './RedisExpirationTimeGroupDataSource'
import type { RedisCacheConfiguration } from './AbstractRedisCache'
import { AbstractRedisCache } from './AbstractRedisCache'
import type { GetManyResult } from '../types/SyncDataSources'

const GROUP_INDEX_KEY = 'group-index'

export interface RedisGroupCacheConfiguration extends RedisCacheConfiguration, GroupCacheConfiguration {
  groupTtlInMsecs?: number
}

export class RedisGroupCache<T>
  extends AbstractRedisCache<RedisGroupCacheConfiguration, T>
  implements GroupCache<T>, GroupDataSource<T>
{
  public readonly expirationTimeLoadingGroupedOperation: GroupLoader<number>
  public ttlLeftBeforeRefreshInMsecs?: number
  name = 'Redis group cache'

  constructor(redis: Redis, config: Partial<RedisGroupCacheConfiguration> = {}) {
    super(redis, config)

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
    if (this.config.ttlInMsecs) {
      await this.redis.multi().incr(key).pexpire(key, this.config.ttlInMsecs).exec()
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

    const transformedKeys = keys.map((key) => this.resolveKeyWithGroup(key, groupId, currentGroupKey))
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
