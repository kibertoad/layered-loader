import type { GroupDataSource } from '../../lib/types/DataSources'
import type { GroupValues, User } from '../types/testTypes'
import { cloneDeep } from '../utils/cloneUtils'

export class DummyGroupedLoader implements GroupDataSource<User> {
  public groupValues: GroupValues | null | undefined

  name = 'Dummy cache'
  isCache = true

  constructor(returnedValues: GroupValues) {
    this.groupValues = cloneDeep(returnedValues)
  }

  getFromGroup(key: string, group: string) {
    return Promise.resolve(this.groupValues?.[group]?.[key])
  }

  getManyFromGroup(keys: string[], group: string): Promise<User[]> {
    const groupValues = this.groupValues?.[group] ?? {}
    const result = Object.values(groupValues).filter((entry) => {
      return entry && keys.includes(entry.userId)
    }) as User[]

    return Promise.resolve(result)
  }
}
