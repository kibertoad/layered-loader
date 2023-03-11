import { GroupLoader } from '../../lib/types/DataSources'
import { GroupValues, User } from '../types/testTypes'
import { cloneDeep } from '../utils/cloneUtils'

export class TemporaryThrowingGroupedLoader implements GroupLoader<User> {
  public groupValues: GroupValues | null | undefined

  name = 'Dummy cache'
  isCache = true
  public isThrowing = true

  constructor(returnedValues: GroupValues) {
    this.groupValues = cloneDeep(returnedValues)
  }

  getFromGroup(key: string, group: string) {
    if (this.isThrowing) {
      return Promise.resolve().then(() => {
        throw new Error('Error has occurred')
      })
    }

    return Promise.resolve(this.groupValues?.[group]?.[key])
  }
}
