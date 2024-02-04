import type {
  GetManyResult,
  SynchronousCache,
  SynchronousGroupCache,
} from '../types/SyncDataSources'

export class NoopCache<T> implements SynchronousCache<T>, SynchronousGroupCache<T> {
  name = 'Noop cache'
  public readonly ttlLeftBeforeRefreshInMsecs = undefined

  deleteGroup() {}

  getFromGroup() {
    return undefined
  }
  setForGroup() {}

  clear(): void {}

  delete(): void {}

  deleteMany(): void {}

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

  getMany(keys: string[]): GetManyResult<T> {
    return {
      unresolvedKeys: keys,
      resolvedValues: [],
    }
  }

  getManyFromGroup(keys: string[], _group: string): GetManyResult<T> {
    return {
      unresolvedKeys: keys,
      resolvedValues: [],
    }
  }

  set(): void {}
}
