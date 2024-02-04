import type { CacheEntry, GroupCache } from '../../lib/types/DataSources'
import type { GetManyResult } from '../../lib/types/SyncDataSources'
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

  setManyForGroup(entries: readonly CacheEntry<User>[], group: string): Promise<unknown> {
    for (const entry of entries) {
      this.groupValues[group][entry.key] = entry.value
    }
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

  close(): Promise<unknown> {
    return Promise.resolve(undefined)
  }

  getManyFromGroup(keys: string[], group: string): Promise<GetManyResult<User>> {
    const groupValues = this.groupValues?.[group] ?? {}
    const foundValues: User[] = Object.values(groupValues).filter((entry) => {
      return entry && keys.includes(entry.userId)
    }) as User[]
    const unresolvedKeys = keys.filter((entry) => {
      return !foundValues.find((foundValue) => {
        return entry === foundValue.userId
      })
    })

    return Promise.resolve({
      resolvedValues: foundValues,
      unresolvedKeys,
    })
  }
}
