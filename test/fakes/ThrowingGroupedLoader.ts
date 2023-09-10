import type { GroupDataSource } from '../../lib/types/DataSources'
import type { User } from '../types/testTypes'

export class ThrowingGroupedLoader<T = User> implements GroupDataSource<T> {
  name = 'Throwing loader'

  getFromGroup(): Promise<T | undefined | null> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  getManyFromGroup(): Promise<T[]> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }
}
