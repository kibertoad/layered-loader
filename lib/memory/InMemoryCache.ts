import type { HitStatisticsRecord, ToadCache } from 'toad-cache'
import type { CommonCacheConfiguration } from '../types/DataSources'
import type { GetManyResult, SynchronousCache } from '../types/SyncDataSources'
import { resolveCacheConstructor } from './memoryCacheUtils'

type CacheTypeId = 'lru-map' | 'fifo-map' | 'lru-object' | 'fifo-object' | 'lru-object-statistics'

export interface InMemoryCacheConfiguration extends CommonCacheConfiguration {
  cacheId?: string
  globalStatisticsRecord?: HitStatisticsRecord
  cacheType?: CacheTypeId
  maxItems?: number
}

const DEFAULT_CONFIGURATION = {
  cacheType: 'lru-map',
  maxItems: 500,
} satisfies Omit<InMemoryCacheConfiguration, 'ttlInMsecs'>

export class InMemoryCache<T> implements SynchronousCache<T> {
  private readonly cache: ToadCache<T | null>
  name = 'In-memory cache'
  public readonly ttlLeftBeforeRefreshInMsecs?: number

  constructor(config: InMemoryCacheConfiguration) {
    const resolvedConstructor = resolveCacheConstructor<CacheTypeId, T>(
      config.cacheType ?? DEFAULT_CONFIGURATION.cacheType,
    )

    this.cache = new resolvedConstructor(
      config.maxItems ?? DEFAULT_CONFIGURATION.maxItems,
      config.ttlInMsecs ?? 0,
      config.cacheId,
      config.globalStatisticsRecord,
    )
    this.ttlLeftBeforeRefreshInMsecs = config.ttlLeftBeforeRefreshInMsecs
  }

  clear(): void {
    this.cache.clear()
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  deleteMany(keys: string[]): void {
    for (let i = 0; i < keys.length; i++) {
      this.delete(keys[i])
    }
  }

  get(key: string): T | null | undefined {
    return this.cache.get(key)
  }

  getMany(keys: string[]): GetManyResult<T> {
    const resolvedValues: T[] = []
    const unresolvedKeys: string[] = []

    for (let i = 0; i < keys.length; i++) {
      const resolvedValue = this.cache.get(keys[i])
      if (resolvedValue) {
        resolvedValues.push(resolvedValue)
      } else {
        unresolvedKeys.push(keys[i])
      }
    }

    return {
      resolvedValues,
      unresolvedKeys,
    }
  }

  getExpirationTime(key: string): number | undefined {
    return this.cache.expiresAt(key)
  }

  set(key: string, value: T | null): void {
    this.cache.set(key, value)
  }
}
