import { SynchronousCache, SynchronousGroupedCache } from '../types/SyncDataSources'

export class NoopCache<T> implements SynchronousCache<T>, SynchronousGroupedCache<T> {
  name = 'Noop cache'
  public readonly ttlLeftBeforeRefreshInMsecs = undefined

  deleteGroup() {}

  getFromGroup() {
    return undefined
  }
  setForGroup() {}

  clear(): void {}

  delete(): void {}
  deleteFromGroup(): void {}

  get(): T | null | undefined {
    return undefined
  }

  getExpirationTimeFromGroup() {
    return undefined
  }

  getExpirationTime() {
    return undefined
  }

  set(): void {}
}
