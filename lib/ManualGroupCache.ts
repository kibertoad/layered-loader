import type { CommonCacheConfig } from './AbstractCache'
import { AbstractGroupCache } from './AbstractGroupCache'
import type { InMemoryGroupCache, InMemoryGroupCacheConfiguration } from './memory/InMemoryGroupCache'
import type { GroupNotificationPublisher } from './notifications/GroupNotificationPublisher'
import type { GroupCache } from './types/DataSources'

export type ManualGroupCacheConfig<LoadedValue> = CommonCacheConfig<
  LoadedValue,
  GroupCache<LoadedValue>,
  InMemoryGroupCacheConfiguration,
  InMemoryGroupCache<LoadedValue>,
  GroupNotificationPublisher<LoadedValue>
>

export class ManualGroupCache<LoadedValue> extends AbstractGroupCache<LoadedValue> {
  constructor(config: ManualGroupCacheConfig<LoadedValue>) {
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
