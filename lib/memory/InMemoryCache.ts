import { Cache, CacheConfiguration, Loader } from '../DataSources'
import type { LRU } from 'tiny-lru'
let TinyLru: any

export interface InMemoryCacheConfiguration extends CacheConfiguration {
  maxItems: number
}

const DefaultConfiguration: InMemoryCacheConfiguration = {
  ttlInMsecs: 1000 * 60 * 10,
  maxItems: 500,
}

export class InMemoryCache<T> implements Cache<T>, Loader<T> {
  private readonly cache: LRU<T | null>
  name = 'In-memory cache'
  isCache = true

  constructor(config: InMemoryCacheConfiguration = DefaultConfiguration) {
    /* istanbul ignore next */
    if (!TinyLru) {
      try {
        TinyLru = require('tiny-lru').lru
      } catch (err) {
        throw new Error("In order to use InMemoryCache, please run \n$ npm install 'tiny-lru' --save")
      }
    }

    this.cache = TinyLru(config.maxItems, config.ttlInMsecs)
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
