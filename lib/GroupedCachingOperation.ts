import type { GroupedCache } from './types/DataSources'
import type { CommonOperationConfig } from './AbstractOperation'
import { AbstractGroupedOperation } from './AbstractGroupedOperation'

export type GroupedCachingOperationConfig<LoadedValue> = CommonOperationConfig<LoadedValue, GroupedCache<LoadedValue>>

export class GroupedCachingOperation<LoadedValue> extends AbstractGroupedOperation<LoadedValue> {
  constructor(config: GroupedCachingOperationConfig<LoadedValue>) {
    super(config)
  }

  public async set(key: string, resolvedValue: LoadedValue, group: string): Promise<void> {
    this.inMemoryCache.setForGroup(key, resolvedValue, group)
    const groupLoads = this.resolveGroupLoads(group)
    this.deleteGroupRunningLoad(groupLoads, group, key)
    if (this.asyncCache) {
      return this.asyncCache.setForGroup(key, resolvedValue, group).catch((err) => {
        this.cacheUpdateErrorHandler(err, key, this.asyncCache!, this.logger)
      })
    }
  }
}
