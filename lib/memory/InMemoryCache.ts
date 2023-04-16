import type { CacheConstructor, ToadCache } from 'toad-cache'
import type { SynchronousCache } from '../types/SyncDataSources'
import type { CommonCacheConfiguration } from '../types/DataSources'
import { resolveCacheConstructor } from './memoryCacheUtils'

type CacheTypeId = 'lru-map' | 'fifo-map' | 'lru-object' | 'fifo-object'

export interface InMemoryCacheConfiguration extends CommonCacheConfiguration {
  cacheType?: CacheTypeId
  maxItems?: number
}

const DEFAULT_CONFIGURATION = {
  cacheType: 'lru-object',
  maxItems: 500,
} satisfies Omit<InMemoryCacheConfiguration, 'ttlInMsecs'>

export class InMemoryCache<T> implements SynchronousCache<T> {
  private readonly cache: ToadCache<T | null>
  name = 'In-memory cache'
  private readonly ttlInMsecs: number | undefined
  public readonly ttlLeftBeforeRefreshInMsecs?: number
  private readonly cacheConstructor: CacheConstructor<ToadCache<T>>

  constructor(config: InMemoryCacheConfiguration) {
    this.cacheConstructor = resolveCacheConstructor<CacheTypeId, T>(config.cacheType ?? DEFAULT_CONFIGURATION.cacheType)

    this.cache = new this.cacheConstructor(config.maxItems ?? DEFAULT_CONFIGURATION.maxItems, config.ttlInMsecs ?? 0)
    this.ttlInMsecs = config.ttlInMsecs
    this.ttlLeftBeforeRefreshInMsecs = config.ttlLeftBeforeRefreshInMsecs
  }

  clear(): void {
    this.cache.clear()
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  get(key: string): T | null | undefined {
    return this.cache.get(key)
  }

  getExpirationTime(key: string): number | undefined {
    return this.cache.expiresAt(key)
  }

  set(key: string, value: T | null): void {
    this.cache.set(key, value)
  }
}
