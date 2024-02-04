import type { GroupDataSource } from '../../lib/types/DataSources'
import type { GroupValues, User } from '../types/testTypes'
import { cloneDeep } from '../utils/cloneUtils'
import type { DummyLoaderParams } from './DummyLoaderWithParams'

export class DummyGroupedLoaderWithParams implements GroupDataSource<User, DummyLoaderParams> {
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

  getManyFromGroup(keys: string[], group: string, params: DummyLoaderParams | undefined): Promise<User[]> {
    if (!params) {
      throw new Error('Params were not passed')
    }

    const groupValues = this.groupValues?.[group] ?? {}
    const result = Object.values(groupValues).filter((entry) => {
      return entry && keys.includes(entry.userId)
    }) as User[]

    const processedResult = result.map((user) => {
      return { ...user, parametrized: `${params.prefix}${params.suffix}` }
    })

    return Promise.resolve(processedResult)
  }
}
