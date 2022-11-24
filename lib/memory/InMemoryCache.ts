import { Cache, CacheConfiguration, GroupedCache, Loader } from '../DataSources'
import type { LRU } from 'tiny-lru'
import { lru } from 'tiny-lru'

export interface InMemoryCacheConfiguration extends CacheConfiguration {
  maxItems: number
  maxGroups: number
  maxItemsPerGroup: number
}

const DefaultConfiguration: InMemoryCacheConfiguration = {
  ttlInMsecs: 1000 * 60 * 10,
  maxItems: 500,
  maxGroups: 1000,
  maxItemsPerGroup: 500,
}

export class InMemoryCache<T> implements Cache<T>, GroupedCache<T>, Loader<T> {
  private readonly cache: LRU<T | null>
  private readonly groups: LRU<LRU<T | null> | undefined | null>
  private readonly config: InMemoryCacheConfiguration
  name = 'In-memory cache'
  isCache = true

  constructor(config: Partial<InMemoryCacheConfiguration> = DefaultConfiguration) {
    this.cache = lru(config.maxItems, config.ttlInMsecs)
    this.groups = lru(config.maxGroups)
    this.config = {
      ...DefaultConfiguration,
      ...config,
    }
  }

  private resolveGroup(groupId: string) {
    const groupCache = this.groups.get(groupId)
    if (groupCache) {
      return groupCache
    }

    const newGroupCache = lru(this.config.maxItemsPerGroup, this.config.ttlInMsecs)
    this.groups.set(groupId, newGroupCache)
    return newGroupCache
  }

  async deleteGroup(group: string) {
    this.groups.delete(group)
  }

  async getFromGroup(key: string, groupId: string) {
    const group = this.resolveGroup(groupId)
    return group.get(key)
  }
  async setForGroup(key: string, value: T | null, groupId: string) {
    const group = this.resolveGroup(groupId)
    group.set(key, value)
  }

  async clear(): Promise<void> {
    this.cache.clear()
    this.groups.clear()
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key)
  }

  async get(key: string): Promise<T | null | undefined> {
    return this.cache.get(key)
  }

  async set(key: string, value: T | null): Promise<void> {
    this.cache.set(key, value)
  }
}
