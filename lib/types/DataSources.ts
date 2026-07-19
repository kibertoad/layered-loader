import type { GroupLoader } from '../GroupLoader.js'
import type { Loader } from '../Loader.js'
import type { GetManyResult } from './SyncDataSources.js'

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

/**
 * Lightweight staleness check invoked when a cached entry enters the refresh window.
 *
 * Return `true` if the cached value is still up-to-date (its TTL will be reset without a refetch),
 * `false` to trigger a full background refetch from the data sources.
 */
export type IsEntryStillCurrentFn<LoadedValue, LoadParams = string> = (
  cachedValue: LoadedValue | null,
  loadParams: LoadParams,
) => Promise<boolean>

/**
 * Group variant of {@link IsEntryStillCurrentFn}.
 */
export type IsGroupEntryStillCurrentFn<LoadedValue, LoadParams = string> = (
  cachedValue: LoadedValue | null,
  loadParams: LoadParams,
  group: string,
) => Promise<boolean>

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

  /**
   * Resets the entry's TTL back to the full configured ttlInMsecs without rewriting the value.
   * Returns `true` if the entry existed and its TTL was extended, `false` otherwise.
   * Implementations that cache expiration times must refresh the cached value for the key on
   * success (invalidate it, or update it to the new expiration).
   */
  resetTtl?: (key: string) => Promise<boolean>
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

  /**
   * Resets the entry's TTL back to the full configured ttlInMsecs without rewriting the value.
   * Returns `true` if the entry existed and its TTL was extended, `false` otherwise.
   * Implementations that cache expiration times must refresh the cached value for the key on
   * success (invalidate it, or update it to the new expiration).
   */
  resetTtlFromGroup?: (key: string, group: string) => Promise<boolean>
}

/**
 * Data source interface for retrieving values.
 *
 * Return value semantics:
 * - Return the actual value when found
 * - Return `null` to indicate "value was resolved but is empty" - this WILL be cached
 * - Return `undefined` to indicate "value was not resolved" - this will NOT be cached,
 *   and the next data source in the sequence will be queried
 */
export interface DataSource<LoadedValue, LoadParams = string, LoadManyParams = LoadParams extends string ? undefined : LoadParams> {
  get: (loadParams: LoadParams) => Promise<LoadedValue | undefined | null>

  // note that we cannot combine keys and loadParams here, because we may be asked to only fetch a subset of originally requested keys, as the others might be cached already
  getMany: (keys: string[], loadParams?: LoadManyParams) => Promise<LoadedValue[]>

  name: string
}

/**
 * Group data source interface for retrieving values within groups.
 *
 * Return value semantics:
 * - Return the actual value when found
 * - Return `null` to indicate "value was resolved but is empty" - this WILL be cached
 * - Return `undefined` to indicate "value was not resolved" - this will NOT be cached,
 *   and the next data source in the sequence will be queried
 */
export interface GroupDataSource<LoadedValue, LoadParams = string, LoadManyParams = LoadParams extends string ? undefined : LoadParams> {
  getFromGroup: (loadParams: LoadParams, group: string) => Promise<LoadedValue | undefined | null>
  getManyFromGroup: (keys: string[], group: string, loadParams?: LoadManyParams) => Promise<LoadedValue[]>

  name: string
}
