import type { GroupCache } from '../../lib/types/DataSources'
import type { User } from '../types/testTypes'
import type { GetManyResult } from '../../lib/types/SyncDataSources'

export class ThrowingGroupedCache implements GroupCache<User> {
  name = 'Throwing grouped cache'
  readonly expirationTimeLoadingGroupedOperation: null
  readonly ttlLeftBeforeRefreshInMsecs: 999999

  get(): Promise<User | undefined | null> {
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

  setManyForGroup(): Promise<unknown> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  deleteGroup(): Promise<void> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  getFromGroup(): Promise<User | undefined | null> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  close(): Promise<unknown> {
    return Promise.resolve(undefined)
  }

  getManyFromGroup(): Promise<GetManyResult<User>> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  setForGroup(): Promise<void> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  deleteFromGroup(): Promise<void> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  getExpirationTimeFromGroup(): Promise<number> {
    return Promise.resolve(99999)
  }

  getExpirationTime(): Promise<number> {
    return Promise.resolve(99999)
  }
}
