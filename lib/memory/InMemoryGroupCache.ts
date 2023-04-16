import type { CacheConstructor, ToadCache } from 'toad-cache'
import type { SynchronousGroupCache } from '../types/SyncDataSources'
import type { InMemoryCacheConfiguration } from './InMemoryCache'
import { resolveCacheConstructor } from './memoryCacheUtils'

type CacheTypeId = 'lru-map' | 'fifo-map' | 'lru-object' | 'fifo-object'

export interface InMemoryGroupCacheConfiguration extends InMemoryCacheConfiguration {
  cacheType?: CacheTypeId
  groupCacheType?: CacheTypeId
  maxGroups?: number
  maxItemsPerGroup?: number
}

const DEFAULT_GROUP_CONFIGURATION = {
  cacheType: 'lru-object',
  groupCacheType: 'lru-object',
  maxGroups: 1000,
  maxItemsPerGroup: 500,
} satisfies Omit<InMemoryGroupCacheConfiguration, 'ttlInMsecs'>

export class InMemoryGroupCache<T> implements SynchronousGroupCache<T> {
  private readonly groups: ToadCache<ToadCache<T | null> | undefined | null>
  private readonly maxItemsPerGroup: number
  name = 'In-memory group cache'
  private readonly ttlInMsecs: number | undefined
  public readonly ttlLeftBeforeRefreshInMsecs?: number
  private readonly cacheConstructor: CacheConstructor<ToadCache<T>>
  private readonly groupCacheConstructor: CacheConstructor<ToadCache<ToadCache<T | null>>>

  constructor(config: InMemoryGroupCacheConfiguration) {
    this.cacheConstructor = resolveCacheConstructor<CacheTypeId, T>(
      config.cacheType ?? DEFAULT_GROUP_CONFIGURATION.cacheType
    )
    this.groupCacheConstructor = resolveCacheConstructor<CacheTypeId, ToadCache<T>>(
      config.groupCacheType ?? DEFAULT_GROUP_CONFIGURATION.groupCacheType
    )

    this.groups = new this.groupCacheConstructor(config.maxGroups ?? DEFAULT_GROUP_CONFIGURATION.maxGroups)
    this.maxItemsPerGroup = config.maxItemsPerGroup ?? DEFAULT_GROUP_CONFIGURATION.maxItemsPerGroup
    this.ttlInMsecs = config.ttlInMsecs
    this.ttlLeftBeforeRefreshInMsecs = config.ttlLeftBeforeRefreshInMsecs
  }

  private resolveGroup(groupId: string) {
    const groupCache = this.groups.get(groupId)
    if (groupCache) {
      return groupCache
    }

    const newGroupCache = new this.cacheConstructor(this.maxItemsPerGroup, this.ttlInMsecs)
    this.groups.set(groupId, newGroupCache)
    return newGroupCache
  }

  deleteGroup(group: string) {
    this.groups.delete(group)
  }

  getFromGroup(key: string, groupId: string) {
    const group = this.resolveGroup(groupId)
    return group.get(key)
  }
  setForGroup(key: string, value: T | null, groupId: string) {
    const group = this.resolveGroup(groupId)
    group.set(key, value)
  }

  deleteFromGroup(key: string, groupId: string): void {
    const group = this.resolveGroup(groupId)
    group.delete(key)
  }

  clear(): void {
    this.groups.clear()
  }

  getExpirationTimeFromGroup(key: string, groupId: string): number | undefined {
    const group = this.resolveGroup(groupId)
    return group.expiresAt(key)
  }
}