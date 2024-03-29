import type { GroupCache } from '../../lib/types/DataSources'
import type { GroupValues, User } from '../types/testTypes'
import { cloneDeep } from '../utils/cloneUtils'

export class TemporaryThrowingGroupedCache implements GroupCache<User> {
  private value: User | undefined
  groupValues: GroupValues

  name = 'Dummy cache'
  isThrowing = true
  readonly expirationTimeLoadingGroupedOperation: null
  readonly ttlLeftBeforeRefreshInMsecs: 99999

  constructor(returnedValues: GroupValues) {
    this.groupValues = cloneDeep(returnedValues)
  }

  deleteGroup(group: string) {
    if (this.isThrowing) {
      return Promise.resolve().then(() => {
        throw new Error('Error has occurred')
      })
    }

    delete this.groupValues[group]
    return Promise.resolve()
  }

  deleteFromGroup(): Promise<void> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  getFromGroup(key: string, group: string) {
    if (this.isThrowing) {
      return Promise.resolve().then(() => {
        throw new Error('Error has occurred')
      })
    }

    return Promise.resolve(this.groupValues[group]?.[key])
  }
  setForGroup(key: string, value: User | null, group: string) {
    if (this.isThrowing) {
      return Promise.resolve().then(() => {
        throw new Error('Error has occurred')
      })
    }

    if (!this.groupValues[group]) {
      this.groupValues[group] = {}
    }
    this.groupValues[group][key] = value

    return Promise.resolve()
  }

  get() {
    if (this.isThrowing) {
      return Promise.resolve().then(() => {
        throw new Error('Error has occurred')
      })
    }

    return Promise.resolve(this.value)
  }

  clear(): Promise<void> {
    if (this.isThrowing) {
      return Promise.resolve().then(() => {
        throw new Error('Error has occurred')
      })
    }

    this.value = undefined
    this.groupValues = {}
    return Promise.resolve(undefined)
  }

  delete(): Promise<void> {
    if (this.isThrowing) {
      return Promise.resolve().then(() => {
        throw new Error('Error has occurred')
      })
    }

    this.value = undefined
    return Promise.resolve(undefined)
  }

  set(_key: string, value: User | null): Promise<void> {
    if (this.isThrowing) {
      return Promise.resolve().then(() => {
        throw new Error('Error has occurred')
      })
    }

    this.value = value ?? undefined
    return Promise.resolve(undefined)
  }

  getExpirationTimeFromGroup(): Promise<number> {
    return Promise.resolve(99999)
  }

  getExpirationTime(): Promise<number> {
    return Promise.resolve(99999)
  }
}
