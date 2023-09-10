import type { GroupDataSource } from '../../lib/types/DataSources'
import type { GroupValues, User } from '../types/testTypes'
import { cloneDeep } from '../utils/cloneUtils'

export class CountingGroupedLoader implements GroupDataSource<User> {
  public counter = 0
  public groupValues: GroupValues | null | undefined

  name = 'Counting grouped loader'

  constructor(returnedValues: GroupValues) {
    this.groupValues = cloneDeep(returnedValues)
  }

  getFromGroup(key: string, group: string) {
    this.counter++
    return Promise.resolve(this.groupValues?.[group]?.[key])
  }

  getManyFromGroup(keys: string[], group: string, _loadParams: undefined): Promise<User[]> {
    this.counter++

    const groupValues = this.groupValues?.[group] ?? {}
    const result = Object.values(groupValues).filter((entry) => {
      return entry && keys.includes(entry.userId)
    }) as User[]

    return Promise.resolve(result)
  }
}
