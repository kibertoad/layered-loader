import { FifoMap } from 'toad-cache'
import type { Cache } from '../../lib/types/DataSources'
import type { GetManyResult } from '../../lib/types/SyncDataSources'
import type { User } from '../types/testTypes'

export class CountingTimedCache implements Cache<string> {
  public counter = 0
  name = 'Counting cache'
  readonly ttlLeftBeforeRefreshInMsecs = 0
  // @ts-ignore
  readonly expirationTimeLoadingOperation: any = null
  public readonly cache: FifoMap<string | null>

  constructor(maxItems: number, tllInMsecs: number) {
    this.cache = new FifoMap<string>(maxItems, tllInMsecs)
  }

  get(key: string): Promise<string | undefined | null> {
    this.counter++
    return Promise.resolve(this.cache.get(key))
  }

  clear(): Promise<void> {
    this.cache.clear()
    return Promise.resolve()
  }

  delete(key: string): Promise<void> {
    this.cache.delete(key)
    return Promise.resolve()
  }

  set(key: string, value: string | null): Promise<void> {
    this.cache.set(key, value)
    return Promise.resolve()
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
