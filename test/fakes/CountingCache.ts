import type { Cache } from '../../lib/types/DataSources'
import type { GetManyResult } from '../../lib/types/SyncDataSources'
import type { User } from '../types/testTypes'

export class CountingCache implements Cache<string> {
  private value: string | undefined
  public counter = 0
  name = 'Counting cache'
  readonly ttlLeftBeforeRefreshInMsecs = 999999
  // @ts-ignore
  readonly expirationTimeLoadingOperation = null

  constructor(returnedValue: string | undefined) {
    this.value = returnedValue
  }

  get(): Promise<string | undefined | null> {
    this.counter++
    return Promise.resolve(this.value)
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

  close(): Promise<unknown> {
    return Promise.resolve(undefined)
  }

  getManyFromGroup(): Promise<GetManyResult<User>> {
    throw new Error('Not implemented')
  }

  deleteMany(): Promise<unknown> {
    throw new Error('Not implemented')
  }

  getMany(): Promise<GetManyResult<string>> {
    throw new Error('Not implemented')
  }

  setMany(): Promise<unknown> {
    throw new Error('Not implemented')
  }
}
