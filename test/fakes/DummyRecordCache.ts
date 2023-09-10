import type { Cache } from '../../lib/types/DataSources'
import type { GetManyResult } from '../../lib/types/SyncDataSources'
import type { User } from '../types/testTypes'

export class DummyRecordCache implements Cache<string> {
  values: Record<string, string | undefined | null>
  name = 'Dummy cache'
  isCache = true
  readonly expirationTimeLoadingOperation: null
  readonly ttlLeftBeforeRefreshInMsecs: 999999

  constructor(returnedValues: Record<string, string>) {
    this.values = returnedValues
  }

  get(key: string): Promise<string | undefined | null> {
    return Promise.resolve(this.values[key])
  }

  getMany(keys: string[]): Promise<GetManyResult<string>> {
    const foundValues: string[] = Object.values(this.values).filter((entry) => {
      return entry && keys.includes(entry)
    }) as string[]
    const unresolvedKeys = keys.filter((entry) => {
      return !foundValues.find((foundValue) => {
        return entry === foundValue
      })
    })

    return Promise.resolve({
      resolvedValues: foundValues,
      unresolvedKeys,
    })
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
