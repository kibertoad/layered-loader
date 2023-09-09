import type { Cache } from '../../lib/types/DataSources'
import type { GetManyResult } from '../../lib/types/SyncDataSources'

export class DummyCache implements Cache<string> {
  value: string | undefined | null
  name = 'Dummy cache'
  isCache = true
  readonly expirationTimeLoadingOperation: null
  readonly ttlLeftBeforeRefreshInMsecs: 999999

  constructor(returnedValue: string | undefined) {
    this.value = returnedValue
  }

  get(_key: string): Promise<string | undefined | null> {
    return Promise.resolve(this.value)
  }

  getMany(keys: string[]): Promise<GetManyResult<string>> {
    const resolvedValues = keys.map(() => this.value as string).filter((entry) => entry != null)

    return Promise.resolve({
      resolvedValues,
      unresolvedKeys: resolvedValues.length === 0 ? keys : [],
    })
  }

  clear(): Promise<void> {
    this.value = undefined
    return Promise.resolve(undefined)
  }

  delete(_key: string): Promise<void> {
    this.value = undefined
    return Promise.resolve(undefined)
  }

  set(_key: string, value: string | null): Promise<void> {
    this.value = value ?? undefined
    return Promise.resolve(undefined)
  }

  getExpirationTime(): Promise<number> {
    return Promise.resolve(99999)
  }
}
