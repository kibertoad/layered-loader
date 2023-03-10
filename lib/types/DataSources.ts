export interface CacheConfiguration {
  ttlInMsecs: number | undefined
}

export interface Cache<LoadedValue> {
  get: (key: string) => Promise<LoadedValue | undefined | null>
  set: (key: string, value: LoadedValue | null) => Promise<void>
  clear: () => Promise<void>
  delete: (key: string) => Promise<void>
}

export interface GroupedCache<LoadedValue> extends Cache<LoadedValue> {
  deleteGroup: (group: string) => Promise<void>
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
