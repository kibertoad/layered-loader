import type { GroupDataSource } from '../../lib/types/DataSources'
import type { GroupValues, User } from '../types/testTypes'
import { cloneDeep } from '../utils/cloneUtils'

export class DelayedCountingGroupedLoader implements GroupDataSource<User> {
  public counter = 0
  public groupValues: GroupValues | null | undefined

  name = 'Counting grouped loader'
  private resolver: (value: PromiseLike<User>) => void
  private promise: Promise<User>
  resolveValue: any

  constructor(returnedValues: GroupValues) {
    this.groupValues = cloneDeep(returnedValues)
  }

  getFromGroup(key: string, group: string) {
    this.counter++
    this.resolveValue = this.groupValues?.[group]?.[key]
    this.promise = new Promise<User>((resolve) => {
      this.resolver = resolve
    })
    return this.promise
  }

  getManyFromGroup(): Promise<User[]> {
    throw new Error('Method not implemented.')
  }

  finishLoading() {
    this.resolver(this.resolveValue)
    return this.promise
  }
}
