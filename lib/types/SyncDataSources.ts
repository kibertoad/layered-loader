export interface SynchronousCache<T> {
  readonly ttlLeftBeforeRefreshInMsecs: number | undefined
  get: (key: string) => T | undefined | null
  set: (key: string, value: T | null) => void
  getExpirationTime: (key: string) => number | undefined
  clear: () => void
  delete: (key: string) => void
}

export interface SynchronousGroupedCache<T> extends SynchronousCache<T> {
  getExpirationTimeFromGroup: (key: string, group: string) => number | undefined
  deleteGroup: (group: string) => void
  deleteFromGroup: (key: string, group: string) => void
  getFromGroup: (key: string, group: string) => T | undefined | null
  setForGroup: (key: string, value: T | null, group: string) => void
}
