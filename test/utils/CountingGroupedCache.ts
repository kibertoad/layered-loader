import { GroupedCache } from '../../lib/types/DataSources'
import { GroupValues, User } from './Types'
import { cloneDeep } from './cloneUtils'

export class CountingGroupedCache implements GroupedCache<User> {
  private groupValues: GroupValues
  private value: User | undefined
  public counter = 0
  name = 'Counting cache'
  isCache = true

  constructor(returnedValues: GroupValues) {
    this.groupValues = cloneDeep(returnedValues)
  }

  deleteGroup(group: string) {
    delete this.groupValues[group]
    return Promise.resolve()
  }

  getFromGroup(key: string, group: string) {
    this.counter++
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
    this.counter++
    return Promise.resolve(this.value)
  }

  clear(): Promise<void> {
    this.value = undefined
    this.groupValues = {}
    return Promise.resolve(undefined)
  }

  delete(_key: string): Promise<void> {
    this.value = undefined
    return Promise.resolve(undefined)
  }

  set(_key: string, value: User | null): Promise<void> {
    this.value = value ?? undefined
    return Promise.resolve(undefined)
  }
}
