import type { CacheConstructor, ToadCache } from 'toad-cache'
import { FifoMap, FifoObject, LruMap, LruObject } from 'toad-cache'

export function resolveCacheConstructor<CacheTypeId, T>(cacheTypeId: CacheTypeId): CacheConstructor<ToadCache<T>> {
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
