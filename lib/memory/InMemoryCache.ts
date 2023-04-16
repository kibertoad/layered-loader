import type { CacheConstructor, ToadCache } from 'toad-cache'
import { FifoMap, FifoObject, LruMap, LruObject } from 'toad-cache'
import type { SynchronousCache, SynchronousGroupCache } from '../types/SyncDataSources'
import type { CommonCacheConfiguration } from '../types/DataSources'

type CacheTypeId = 'lru-map' | 'fifo-map' | 'lru-object' | 'fifo-object'

export interface InMemoryCacheConfiguration extends CommonCacheConfiguration {
  cacheType?: CacheTypeId
  groupCacheType?: CacheTypeId
  maxItems?: number
  maxGroups?: number
  maxItemsPerGroup?: number
}

const DEFAULT_CONFIGURATION = {
  cacheType: 'lru-object',
  groupCacheType: 'lru-object',
  maxItems: 500,
  maxGroups: 1000,
  maxItemsPerGroup: 500,
} satisfies Omit<InMemoryCacheConfiguration, 'ttlInMsecs'>

export class InMemoryCache<T> implements SynchronousCache<T>, SynchronousGroupCache<T> {
  private readonly cache: ToadCache<T | null>
  private readonly groups: ToadCache<ToadCache<T | null> | undefined | null>
  private readonly maxItemsPerGroup: number
  name = 'In-memory cache'
  private readonly ttlInMsecs: number | undefined
  public readonly ttlLeftBeforeRefreshInMsecs?: number
  private readonly cacheConstructor: CacheConstructor<ToadCache<T>>
  private readonly groupCacheConstructor: CacheConstructor<ToadCache<ToadCache<T | null>>>

  constructor(config: InMemoryCacheConfiguration) {
    this.cacheConstructor = this.resolveCacheConstructor<T>(config.cacheType ?? DEFAULT_CONFIGURATION.cacheType)
    this.groupCacheConstructor = this.resolveCacheConstructor<ToadCache<T | null>>(
      config.groupCacheType ?? DEFAULT_CONFIGURATION.groupCacheType
    )

    this.cache = new this.cacheConstructor(config.maxItems ?? DEFAULT_CONFIGURATION.maxItems, config.ttlInMsecs ?? 0)
    this.groups = new this.groupCacheConstructor(config.maxGroups ?? DEFAULT_CONFIGURATION.maxGroups)
    this.maxItemsPerGroup = config.maxItemsPerGroup ?? DEFAULT_CONFIGURATION.maxItemsPerGroup
    this.ttlInMsecs = config.ttlInMsecs
    this.ttlLeftBeforeRefreshInMsecs = config.ttlLeftBeforeRefreshInMsecs
  }

  private resolveCacheConstructor<T>(cacheTypeId: CacheTypeId): CacheConstructor<ToadCache<T>> {
    if (cacheTypeId === 'fifo-map') {
      return FifoMap
    } else if (cacheTypeId === 'lru-map') {
      return LruMap
    } else if (cacheTypeId === 'fifo-object') {
      return FifoObject
    } else {
      return LruObject
    }
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
    this.cache.clear()
    this.groups.clear()
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  get(key: string): T | null | undefined {
    return this.cache.get(key)
  }

  getExpirationTimeFromGroup(key: string, groupId: string): number | undefined {
    const group = this.resolveGroup(groupId)
    return group.expiresAt(key)
  }

  getExpirationTime(key: string): number | undefined {
    return this.cache.expiresAt(key)
  }

  set(key: string, value: T | null): void {
    this.cache.set(key, value)
  }
}
