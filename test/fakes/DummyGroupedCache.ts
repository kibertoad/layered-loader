import type { GroupCache } from '../../lib/types/DataSources'
import type { GroupValues, User } from '../types/testTypes'
import { cloneDeep } from '../utils/cloneUtils'

export class DummyGroupedCache implements GroupCache<User> {
  private value: User | undefined
  groupValues: GroupValues
  name = 'Dummy cache'
  readonly expirationTimeLoadingGroupedOperation: null
  readonly ttlLeftBeforeRefreshInMsecs: 99999

  constructor(returnedValues: GroupValues) {
    this.groupValues = cloneDeep(returnedValues)
  }

  deleteGroup(group: string) {
    delete this.groupValues[group]
    return Promise.resolve()
  }

  getFromGroup(key: string, group: string) {
    return Promise.resolve(this.groupValues[group]?.[key])
  }
  setForGroup(key: string, value: User | null, group: string) {
    if (!this.groupValues[group]) {
      this.groupValues[group] = {}
    }
    this.groupValues[group][key] = value

    return Promise.resolve()
  }

  get() {
    return Promise.resolve(this.value)
  }

  clear(): Promise<void> {
    this.value = undefined
    this.groupValues = {}
    return Promise.resolve(undefined)
  }

  delete(): Promise<void> {
    this.value = undefined
    return Promise.resolve(undefined)
  }

  set(_key: string, value: User | null): Promise<void> {
    this.value = value ?? undefined
    return Promise.resolve(undefined)
  }

  deleteFromGroup(key: string, group: string): Promise<void> {
    delete this.groupValues[group][key]
    return Promise.resolve()
  }

  getExpirationTimeFromGroup(): Promise<number> {
    return Promise.resolve(99999)
  }

  getExpirationTime(): Promise<number> {
    return Promise.resolve(99999)
  }
}
