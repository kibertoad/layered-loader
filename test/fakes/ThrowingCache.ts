import type { Cache } from '../../lib/types/DataSources'
import type { GetManyResult } from '../../lib/types/SyncDataSources'

export class ThrowingCache implements Cache<string> {
  name = 'Throwing cache'
  isCache = true
  readonly expirationTimeLoadingOperation: null
  readonly ttlLeftBeforeRefreshInMsecs: 999999

  get(): Promise<string | undefined | null> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  getMany(): Promise<GetManyResult<string>> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  clear(): Promise<void> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  delete(): Promise<void> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  set(): Promise<void> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  getExpirationTime(): Promise<number> {
    return Promise.resolve(99999)
  }
}
