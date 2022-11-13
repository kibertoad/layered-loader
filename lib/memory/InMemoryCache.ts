import { Cache, CacheConfiguration, Loader } from '../DataSources'
import type { LRU } from 'tiny-lru'
import { lru } from 'tiny-lru'

export interface InMemoryCacheConfiguration extends CacheConfiguration {
  maxItems: number
  maxGroups: number
}

const DefaultConfiguration: InMemoryCacheConfiguration = {
  ttlInMsecs: 1000 * 60 * 10,
  maxItems: 500,
  maxGroups: 1000,
}

export class InMemoryCache<T> implements Cache<T>, Loader<T> {
  private readonly cache: LRU<T | null>
  name = 'In-memory cache'
  isCache = true

  constructor(config: InMemoryCacheConfiguration = DefaultConfiguration) {
    this.cache = lru(config.maxItems, config.ttlInMsecs)
  }

  async clear(): Promise<void> {
    this.cache.clear()
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
