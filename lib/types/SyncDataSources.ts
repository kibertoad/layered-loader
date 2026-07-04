export interface SynchronousWriteCache<T> {
  set: (key: string, value: T | null) => void
  delete: (key: string) => void
  deleteMany: (keys: string[]) => void
  clear: () => void
}

export type GetManyResult<T> = {
  resolvedValues: T[]
  unresolvedKeys: string[]
}

export interface SynchronousCache<LoadedValue> extends SynchronousWriteCache<LoadedValue> {
  readonly ttlLeftBeforeRefreshInMsecs?: number
  get: (key: string) => LoadedValue | undefined | null
  getMany: (keys: string[]) => GetManyResult<LoadedValue>
  getExpirationTime: (key: string) => number | undefined

  /**
   * Resets the entry's TTL back to the full configured ttlInMsecs without changing the value.
   * Returns `true` if the entry existed and its TTL was extended, `false` if it had already
   * vanished (expired or invalidated).
   */
  resetTtl: (key: string) => boolean
}

export interface SynchronousWriteGroupCache<T> {
  setForGroup: (key: string, value: T | null, group: string) => void
  deleteFromGroup: (key: string, group: string) => void
  deleteGroup: (group: string) => void
  clear: () => void
}
export interface SynchronousGroupCache<T> extends SynchronousWriteGroupCache<T> {
  readonly ttlLeftBeforeRefreshInMsecs?: number

  getFromGroup: (key: string, group: string) => T | undefined | null
  getManyFromGroup: (keys: string[], group: string) => GetManyResult<T>
  getExpirationTimeFromGroup: (key: string, group: string) => number | undefined

  /**
   * Resets the entry's TTL back to the full configured ttlInMsecs without changing the value.
   * Returns `true` if the entry existed and its TTL was extended, `false` if it (or its group)
   * had already vanished (expired or invalidated).
   */
  resetTtlFromGroup: (key: string, group: string) => boolean
}
