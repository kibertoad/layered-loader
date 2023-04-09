import type { LoadingOperation } from '../LoadingOperation'
import type { GroupedLoadingOperation } from '../GroupedLoadingOperation'

export interface CacheConfiguration {
  ttlLeftBeforeRefreshInMsecs?: number
  ttlCacheTtl?: number // for how long to store ttl locally - useful when refresh is enabled
  ttlCacheSize?: number
  ttlCacheGroupSize?: number
  ttlInMsecs: number | undefined
}

export interface Cache<LoadedValue> {
  readonly ttlLeftBeforeRefreshInMsecs?: number
  readonly expirationTimeLoadingOperation: LoadingOperation<number>
  readonly expirationTimeLoadingGroupedOperation: GroupedLoadingOperation<number>
  get: (key: string) => Promise<LoadedValue | undefined | null>
  set: (key: string, value: LoadedValue | null) => Promise<unknown>
  getExpirationTime: (key: string) => Promise<number | undefined>
  clear: () => Promise<void>
  delete: (key: string) => Promise<unknown>
}

export interface GroupedCache<LoadedValue> extends Cache<LoadedValue> {
  getExpirationTimeFromGroup: (key: string, group: string) => Promise<number | undefined>
  deleteGroup: (group: string) => Promise<unknown>
  deleteFromGroup: (key: string, group: string) => Promise<void>
  getFromGroup: (key: string, group: string) => Promise<LoadedValue | undefined | null>
  setForGroup: (key: string, value: LoadedValue | null, group: string) => Promise<void>
}

export interface Loader<LoadedValue, LoadParams = undefined> {
  get: (key: string, loadParams?: LoadParams) => Promise<LoadedValue | undefined | null>

  name: string
}

export interface GroupLoader<LoadedValue, LoadParams = undefined> {
  getFromGroup: (key: string, group: string, loadParams?: LoadParams) => Promise<LoadedValue | undefined | null>

  name: string
}
