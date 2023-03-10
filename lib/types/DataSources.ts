export interface CacheConfiguration {
  ttlInMsecs: number | undefined
}

export interface Cache<T> extends Loader<T> {
  set: (key: string, value: T | null) => Promise<void>
  clear: () => Promise<void>
  delete: (key: string) => Promise<void>
}

export interface GroupedCache<T> extends Cache<T> {
  deleteGroup: (group: string) => Promise<void>
  deleteFromGroup: (key: string, group: string) => Promise<void>
  getFromGroup: (key: string, group: string) => Promise<T | undefined | null>
  setForGroup: (key: string, value: T | null, group: string) => Promise<void>
}

export interface Loader<T> {
  get: (key: string) => Promise<T | undefined | null>

  name: string
}

export interface GroupLoader<T> {
  getFromGroup: (key: string, group: string) => Promise<T | undefined | null>

  name: string
}
