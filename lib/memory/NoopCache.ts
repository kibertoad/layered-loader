import { SynchronousCache, SynchronousGroupedCache } from '../types/SyncDataSources'

export class NoopCache<T> implements SynchronousCache<T>, SynchronousGroupedCache<T> {
  name = 'Noop cache'

  deleteGroup() {}

  getFromGroup() {
    return undefined
  }
  setForGroup() {}

  clear(): void {}

  delete(): void {}

  get(): T | null | undefined {
    return undefined
  }

  set(): void {}
}
