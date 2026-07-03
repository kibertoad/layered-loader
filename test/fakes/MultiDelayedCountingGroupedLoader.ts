import type { GroupDataSource } from '../../lib/types/DataSources'
import type { GroupValues, User } from '../types/testTypes'
import { cloneDeep } from '../utils/cloneUtils'

/**
 * Unlike DelayedCountingGroupedLoader, this fake supports several concurrent pending loads:
 * each getFromGroup call queues its own resolver and finishLoading() settles them in FIFO order.
 */
export class MultiDelayedCountingGroupedLoader implements GroupDataSource<User> {
  public counter = 0
  public groupValues: GroupValues | null | undefined

  name = 'Multi delayed counting grouped loader'
  private pendingLoads: { resolve: (value: any) => void; value: any; promise: Promise<User> }[] = []

  constructor(returnedValues: GroupValues) {
    this.groupValues = cloneDeep(returnedValues)
  }

  getFromGroup(key: string, group: string) {
    this.counter++
    const value = this.groupValues?.[group]?.[key]
    let resolve!: (value: any) => void
    const promise = new Promise<User>((_resolve) => {
      resolve = _resolve
    })
    this.pendingLoads.push({ resolve, value, promise })
    return promise
  }

  getManyFromGroup(): Promise<User[]> {
    throw new Error('Method not implemented.')
  }

  finishLoading() {
    const pendingLoad = this.pendingLoads.shift()
    if (!pendingLoad) {
      throw new Error('No pending load to finish')
    }
    pendingLoad.resolve(pendingLoad.value)
    return pendingLoad.promise
  }
}
