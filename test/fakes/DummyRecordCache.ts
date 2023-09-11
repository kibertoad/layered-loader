import type { Cache, CacheEntry } from '../../lib/types/DataSources'
import type { GetManyResult } from '../../lib/types/SyncDataSources'
import type { User } from '../types/testTypes'

export class DummyRecordCache implements Cache<string> {
  values: Record<string, string | undefined | null>
  name = 'Dummy cache'
  isCache = true
  readonly expirationTimeLoadingOperation: null
  readonly ttlLeftBeforeRefreshInMsecs: 999999

  constructor(returnedValues: Record<string, string>) {
    this.values = returnedValues ?? {}
  }

  get(key: string): Promise<string | undefined | null> {
    return Promise.resolve(this.values[key])
  }

  getMany(keys: string[]): Promise<GetManyResult<string>> {
    const foundValues: string[] = Object.entries(this.values)
      .filter(([key, value]) => {
        return value && keys.includes(key)
      })
      .map((entry) => entry[1])

    const unresolvedKeys = keys.filter((key) => {
      return !Object.prototype.hasOwnProperty.call(this.values, key)
    })

    return Promise.resolve({
      resolvedValues: foundValues,
      unresolvedKeys,
    })
  }

  setMany(entries: readonly CacheEntry<string>[]): Promise<unknown> {
    for (let entry of entries) {
      this.values[entry.key] = entry.value
    }
    return Promise.resolve()
  }

  clear(): Promise<void> {
    this.values = {}
    return Promise.resolve(undefined)
  }

  delete(key: string): Promise<void> {
    delete this.values[key]
    return Promise.resolve(undefined)
  }

  deleteMany(keys: string[]): Promise<unknown> {
    for (let key of keys) {
      delete this.values[key]
    }
    return Promise.resolve(undefined)
  }

  set(key: string, value: string | null): Promise<void> {
    this.values[key] = value
    return Promise.resolve(undefined)
  }

  getExpirationTime(): Promise<number> {
    return Promise.resolve(99999)
  }

  close(): Promise<unknown> {
    return Promise.resolve(undefined)
  }

  getManyFromGroup(): Promise<GetManyResult<User>> {
    throw new Error('Not implemented')
  }
}
