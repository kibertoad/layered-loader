import type { CacheConstructor, HitStatisticsRecord, ToadCache } from 'toad-cache'
import type { CommonCacheConfiguration } from '../types/DataSources'
import type { GetManyResult, SynchronousGroupCache } from '../types/SyncDataSources'
import { resolveCacheConstructor } from './memoryCacheUtils'

type CacheTypeId = 'lru-map' | 'fifo-map' | 'lru-object' | 'fifo-object' | 'lru-object-statistics'

export interface InMemoryGroupCacheConfiguration extends CommonCacheConfiguration {
  cacheId?: string
  globalStatisticsRecord?: HitStatisticsRecord
  cacheType?: CacheTypeId
  groupCacheType?: CacheTypeId
  groupTtlInMsecs?: number
  maxGroups?: number
  maxItemsPerGroup?: number
}

const DEFAULT_GROUP_CONFIGURATION = {
  cacheType: 'lru-object',
  groupCacheType: 'lru-object',
  maxGroups: 1000,
  maxItemsPerGroup: 500,
  groupTtlInMsecs: 0, // does not expire
} satisfies Omit<InMemoryGroupCacheConfiguration, 'ttlInMsecs'>

export class InMemoryGroupCache<T> implements SynchronousGroupCache<T> {
  private readonly groups: ToadCache<ToadCache<T | null> | undefined | null>
  private readonly maxItemsPerGroup: number
  name = 'In-memory group cache'
  private readonly ttlInMsecs: number | undefined
  public readonly ttlLeftBeforeRefreshInMsecs?: number
  private readonly cacheConstructor: CacheConstructor<ToadCache<T>>
  private readonly groupCacheConstructor: CacheConstructor<ToadCache<ToadCache<T | null>>>
  private readonly cacheId?: string
  private readonly globalStatisticsRecord?: HitStatisticsRecord

  constructor(config: InMemoryGroupCacheConfiguration) {
    this.cacheConstructor = resolveCacheConstructor<CacheTypeId, T>(
      config.cacheType ?? DEFAULT_GROUP_CONFIGURATION.cacheType,
    )
    this.groupCacheConstructor = resolveCacheConstructor<CacheTypeId, ToadCache<T>>(
      config.groupCacheType ?? DEFAULT_GROUP_CONFIGURATION.groupCacheType,
    )

    this.groups = new this.groupCacheConstructor(
      config.maxGroups ?? DEFAULT_GROUP_CONFIGURATION.maxGroups,
      config.groupTtlInMsecs ?? DEFAULT_GROUP_CONFIGURATION.groupTtlInMsecs,
      config.cacheId ? `${config.cacheId} (groups)` : config.cacheId,
      config.globalStatisticsRecord,
    )
    this.maxItemsPerGroup = config.maxItemsPerGroup ?? DEFAULT_GROUP_CONFIGURATION.maxItemsPerGroup
    this.ttlInMsecs = config.ttlInMsecs
    this.ttlLeftBeforeRefreshInMsecs = config.ttlLeftBeforeRefreshInMsecs
    this.cacheId = config.cacheId
    this.globalStatisticsRecord = config.globalStatisticsRecord
  }

  private resolveGroup(groupId: string) {
    const groupCache = this.groups.get(groupId)
    if (groupCache) {
      return groupCache
    }

    const newGroupCache = new this.cacheConstructor(
      this.maxItemsPerGroup,
      this.ttlInMsecs,
      this.cacheId ? `${this.cacheId} (group ${groupId})` : this.cacheId,
      // @ts-ignore
      this.globalStatisticsRecord,
    )
    this.groups.set(groupId, newGroupCache)
    return newGroupCache
  }

  deleteGroup(group: string) {
    this.groups.delete(group)
  }

  getFromGroup(key: string, groupId: string) {
    return this.groups.get(groupId)?.get(key)
  }

  getManyFromGroup(keys: string[], group: string): GetManyResult<T> {
    const groupCache = this.groups.get(group)
    if (!groupCache) {
      return {
        resolvedValues: [],
        unresolvedKeys: keys,
      }
    }

    const resolvedValues: T[] = []
    const unresolvedKeys: string[] = []

    for (let i = 0; i < keys.length; i++) {
      const resolvedValue = groupCache.get(keys[i])
      // null means "resolved to an empty value" and is served from cache, same as in single-key get
      if (resolvedValue !== undefined) {
        resolvedValues.push(resolvedValue as T)
      } else {
        unresolvedKeys.push(keys[i])
      }
    }

    return {
      resolvedValues,
      unresolvedKeys,
    }
  }

  setForGroup(key: string, value: T | null, groupId: string) {
    const group = this.resolveGroup(groupId)
    group.set(key, value)
  }

  deleteFromGroup(key: string, groupId: string): void {
    this.groups.get(groupId)?.delete(key)
  }

  clear(): void {
    this.groups.clear()
  }

  getExpirationTimeFromGroup(key: string, groupId: string): number | undefined {
    return this.groups.get(groupId)?.expiresAt(key)
  }
}
