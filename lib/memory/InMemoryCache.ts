import type { LRU } from 'toad-cache'
import { fifo, lru, ToadCache } from 'toad-cache'
import { SynchronousCache, SynchronousGroupedCache } from '../types/SyncDataSources'
import { CacheConfiguration } from '../types/DataSources'

export interface InMemoryCacheConfiguration extends CacheConfiguration {
  cacheType?: 'lru' | 'fifo'
  maxItems?: number
  maxGroups?: number
  maxItemsPerGroup?: number
}

const DEFAULT_CONFIGURATION = {
  cacheType: 'lru',
  maxItems: 500,
  maxGroups: 1000,
  maxItemsPerGroup: 500,
} satisfies Omit<InMemoryCacheConfiguration, 'ttlInMsecs'>

export class InMemoryCache<T> implements SynchronousCache<T>, SynchronousGroupedCache<T> {
  private readonly cache: ToadCache<T | null>
  private readonly groups: LRU<ToadCache<T | null> | undefined | null>
  private readonly maxItemsPerGroup: number
  name = 'In-memory cache'
  private readonly ttlInMsecs: number | undefined
  public readonly ttlLeftBeforeRefreshInMsecs?: number
  private readonly cacheConstructor: <T = any>(max?: number, ttl?: number) => ToadCache<T>

  constructor(config: InMemoryCacheConfiguration) {
    const cacheType = config.cacheType ?? DEFAULT_CONFIGURATION.cacheType
    this.cacheConstructor = cacheType === 'fifo' ? fifo : lru

    this.cache = this.cacheConstructor(config.maxItems ?? DEFAULT_CONFIGURATION.maxItems, config.ttlInMsecs ?? 0)
    this.groups = lru(config.maxGroups ?? DEFAULT_CONFIGURATION.maxGroups)
    this.maxItemsPerGroup = config.maxItemsPerGroup ?? DEFAULT_CONFIGURATION.maxItemsPerGroup
    this.ttlInMsecs = config.ttlInMsecs
    this.ttlLeftBeforeRefreshInMsecs = config.ttlLeftBeforeRefreshInMsecs
  }

  private resolveGroup(groupId: string) {
    const groupCache = this.groups.get(groupId)
    if (groupCache) {
      return groupCache
    }

    const newGroupCache = this.cacheConstructor(this.maxItemsPerGroup, this.ttlInMsecs)
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
