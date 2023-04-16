export interface SynchronousCache<T> {
  readonly ttlLeftBeforeRefreshInMsecs?: number
  get: (key: string) => T | undefined | null
  set: (key: string, value: T | null) => void
  getExpirationTime: (key: string) => number | undefined
  delete: (key: string) => void
  clear: () => void
}

export interface SynchronousGroupCache<T> {
  readonly ttlLeftBeforeRefreshInMsecs?: number

  getFromGroup: (key: string, group: string) => T | undefined | null
  setForGroup: (key: string, value: T | null, group: string) => void
  getExpirationTimeFromGroup: (key: string, group: string) => number | undefined
  deleteFromGroup: (key: string, group: string) => void
  deleteGroup: (group: string) => void
  clear: () => void
}
