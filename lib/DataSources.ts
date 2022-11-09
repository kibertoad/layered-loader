export interface CacheConfiguration {
  ttlInMsecs?: number
  group?: string
}

export interface KeyConfiguration {
  group?: string
}

export interface Cache<T> extends Loader<T> {
  set: (key: string, value: T | null, config?: CacheConfiguration) => Promise<void>
  clear: () => Promise<void>
  delete: (key: string, config?: KeyConfiguration) => Promise<void>
}

export interface Loader<T> {
  get: (key: string, config?: KeyConfiguration) => Promise<T | undefined | null>

  isCache: boolean
  name: string
}
