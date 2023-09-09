export interface SynchronousWriteCache<T> {
  set: (key: string, value: T | null) => void
  delete: (key: string) => void
  clear: () => void
}

export type GetManyResult<T> = {
  resolvedValues: T[]
  unresolvedKeys: string[]
}

export interface SynchronousCache<T> extends SynchronousWriteCache<T> {
  readonly ttlLeftBeforeRefreshInMsecs?: number
  get: (key: string) => T | undefined | null
  getMany: (keys: string[]) => GetManyResult<T>
  getExpirationTime: (key: string) => number | undefined
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
}
