import { GroupLoader } from '../../lib/types/DataSources'
import { GroupValues, User } from '../types/testTypes'
import { cloneDeep } from '../utils/cloneUtils'

export class CountingGroupedLoader implements GroupLoader<User> {
  public counter = 0
  public groupValues: GroupValues | null | undefined

  name = 'Counting grouped loader'
  isCache = true

  constructor(returnedValues: GroupValues) {
    this.groupValues = cloneDeep(returnedValues)
  }

  getFromGroup(key: string, group: string) {
    this.counter++
    return Promise.resolve(this.groupValues?.[group]?.[key])
  }
}
