import type { CacheConstructor, ToadCache } from 'toad-cache'
import { FifoMap, FifoObject, LruMap, LruObject, LruObjectHitStatistics } from 'toad-cache'

export function resolveCacheConstructor<CacheTypeId, T>(cacheTypeId: CacheTypeId): CacheConstructor<ToadCache<T>> {
  if (cacheTypeId === 'fifo-map') {
    return FifoMap
  } else if (cacheTypeId === 'lru-map') {
    return LruMap
  } else if (cacheTypeId === 'lru-object-statistics') {
    return LruObjectHitStatistics
  } else if (cacheTypeId === 'fifo-object') {
    return FifoObject
  } else {
    return LruObject
  }
}
