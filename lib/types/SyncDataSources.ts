export interface SynchronousCache<T> {
  get: (key: string) => T | undefined | null
  set: (key: string, value: T | null) => void
  clear: () => void
  delete: (key: string) => void
}

export interface SynchronousGroupedCache<T> extends SynchronousCache<T> {
  deleteGroup: (group: string) => void
  deleteFromGroup: (key: string, group: string) => void
  getFromGroup: (key: string, group: string) => T | undefined | null
  setForGroup: (key: string, value: T | null, group: string) => void
}
