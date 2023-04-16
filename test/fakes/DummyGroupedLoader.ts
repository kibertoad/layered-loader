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
}
