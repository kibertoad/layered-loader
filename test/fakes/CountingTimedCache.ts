import type { Cache } from '../../lib/types/DataSources'
import type { GetManyResult } from '../../lib/types/SyncDataSources'
import type { User } from '../types/testTypes'
import { FifoMap } from 'toad-cache'

export class CountingTimedCache implements Cache<string> {
  public counter = 0
  name = 'Counting cache'
  readonly ttlLeftBeforeRefreshInMsecs = 0
  // @ts-ignore
  readonly expirationTimeLoadingOperation = null
  public readonly cache: FifoMap<string | null>

  constructor(maxItems: number, tllInMsecs: number) {
    this.cache = new FifoMap<string>(maxItems, tllInMsecs)
  }

  async get(key: string): Promise<string | undefined | null> {
    this.counter++
    return this.cache.get(key)
  }

  async clear(): Promise<void> {
    this.cache.clear()
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key)
  }

  async set(key: string, value: string | null): Promise<void> {
    this.cache.set(key, value)
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
