export interface CacheConfiguration {
  ttlInMsecs: number
}

export interface Cache<T> {
  set: (key: string, value: T | null, config?: CacheConfiguration) => Promise<void>
  clear: () => Promise<void>
  delete: (key: string) => Promise<void>
}

export interface Loader<T> {
  get: (key: string) => Promise<T | undefined | null>
  isCache: boolean
}
