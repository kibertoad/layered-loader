import { GroupLoader } from '../../lib/types/DataSources'
import { GroupValues, User } from '../types/testTypes'
import { cloneDeep } from '../utils/cloneUtils'

export class DelayedCountingGroupedLoader implements GroupLoader<User> {
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

  finishLoading() {
    this.resolver(this.resolveValue)
    return this.promise
  }
}
