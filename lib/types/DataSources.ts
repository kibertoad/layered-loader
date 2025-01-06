import type { GroupLoader } from '../GroupLoader'
import type { Loader } from '../Loader'
import type { GetManyResult } from './SyncDataSources'

export interface CommonCacheConfiguration {
  ttlLeftBeforeRefreshInMsecs?: number
  ttlCacheTtl?: number // for how long to store ttl locally - useful when refresh is enabled
  ttlCacheSize?: number
  ttlInMsecs: number | undefined
}

export interface GroupCacheConfiguration extends CommonCacheConfiguration {
  ttlCacheGroupSize?: number
}

export type CacheEntry<LoadedValue> = {
  key: string
  value: LoadedValue
}

export interface WriteCache<LoadedValue> {
  set: (key: string, value: LoadedValue | null) => Promise<unknown>
  setMany: (entries: readonly CacheEntry<LoadedValue>[]) => Promise<unknown>
  delete: (key: string) => Promise<unknown>
  deleteMany: (keys: string[]) => Promise<unknown>
  clear: () => Promise<unknown>
  close: () => Promise<unknown>
}

export interface Cache<LoadedValue> extends WriteCache<LoadedValue> {
  readonly ttlLeftBeforeRefreshInMsecs?: number
  readonly expirationTimeLoadingOperation: Loader<number>
  get: (key: string) => Promise<LoadedValue | undefined | null>
  getMany: (keys: string[]) => Promise<GetManyResult<LoadedValue>>
  getExpirationTime: (key: string) => Promise<number | undefined>
}

export interface GroupWriteCache<LoadedValue> {
  setForGroup: (key: string, value: LoadedValue | null, group: string) => Promise<void>
  setManyForGroup: (entries: readonly CacheEntry<LoadedValue>[], group: string) => Promise<unknown>
  deleteGroup: (group: string) => Promise<unknown>
  deleteFromGroup: (key: string, group: string) => Promise<unknown>
  clear: () => Promise<unknown>
  close: () => Promise<unknown>
}

export interface GroupCache<LoadedValue> extends GroupWriteCache<LoadedValue> {
  readonly ttlLeftBeforeRefreshInMsecs?: number
  readonly expirationTimeLoadingGroupedOperation: GroupLoader<number>

  getFromGroup: (key: string, group: string) => Promise<LoadedValue | undefined | null>
  getManyFromGroup: (keys: string[], group: string) => Promise<GetManyResult<LoadedValue>>
  getExpirationTimeFromGroup: (key: string, group: string) => Promise<number | undefined>
}

export interface DataSource<LoadedValue, LoadParams = string> {
  get: (loadParams: LoadParams) => Promise<LoadedValue | undefined | null>
  getMany: (keys: string[], loadParams?: LoadParams) => Promise<LoadedValue[]>

  name: string
}

export interface GroupDataSource<LoadedValue, LoadParams = string> {
  getFromGroup: (loadParams: LoadParams, group: string) => Promise<LoadedValue | undefined | null>
  getManyFromGroup: (keys: string[], group: string, loadParams?: LoadParams) => Promise<LoadedValue[]>

  name: string
}
