import { Cache, CacheConfiguration, Loader } from './Loader'
import { Lru } from 'tiny-lru'
const TinyLru = require('tiny-lru')

export interface InMemoryCacheConfiguration extends CacheConfiguration {
  maxItems: number
}

const DefaultConfiguration: InMemoryCacheConfiguration = {
  ttlInMsecs: 1000 * 60 * 10,
  maxItems: 500,
}

export class InMemoryCache<T> implements Cache<T>, Loader<T> {
  private readonly cache: Lru
  isCache = true

  constructor(config: InMemoryCacheConfiguration = DefaultConfiguration) {
    this.cache = TinyLru(config.maxItems, config.ttlInMsecs)
  }

  async clear(): Promise<void> {
    this.cache.clear()
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key)
  }

  async get(key: string): Promise<T> {
    return this.cache.get(key)
  }

  async set(key: string, value: T | null): Promise<void> {
    this.cache.set(key, value)
  }
}
