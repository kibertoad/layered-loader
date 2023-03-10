import { GroupLoader } from '../../lib/types/DataSources'
import { GroupValues, User } from '../types/testTypes'
import { cloneDeep } from '../utils/cloneUtils'
import { DummyLoaderParams } from './DummyLoaderWithParams'

export class DummyGroupedLoaderWithParams implements GroupLoader<User, DummyLoaderParams> {
  public groupValues: GroupValues | null | undefined

  name = 'Dummy cache'
  isCache = true

  constructor(returnedValues: GroupValues) {
    this.groupValues = cloneDeep(returnedValues)
  }

  getFromGroup(key: string, group: string, params?: DummyLoaderParams) {
    if (!params) {
      throw new Error('Params were not passed')
    }
    const user = this.groupValues?.[group]?.[key]
    if (!user) {
      throw new Error('User not found')
    }
    return Promise.resolve({ ...user, parametrized: `${params.prefix}${params.suffix}` })
  }
}
