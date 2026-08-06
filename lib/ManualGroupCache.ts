import type { CommonCacheConfig } from './AbstractCache.js'
import { AbstractGroupCache } from './AbstractGroupCache.js'
import type { InMemoryGroupCacheConfiguration } from './memory/InMemoryGroupCache.js'
import type { GroupNotificationPublisher } from './notifications/GroupNotificationPublisher.js'
import type { GroupCache } from './types/DataSources.js'
import type { SynchronousGroupCache } from './types/SyncDataSources.js'

export type ManualGroupCacheConfig<LoadedValue> = CommonCacheConfig<
  LoadedValue,
  GroupCache<LoadedValue>,
  InMemoryGroupCacheConfiguration,
  SynchronousGroupCache<LoadedValue>,
  GroupNotificationPublisher<LoadedValue>
>

export class ManualGroupCache<LoadedValue> extends AbstractGroupCache<LoadedValue> {
  constructor(config: ManualGroupCacheConfig<LoadedValue>) {
    super(config)
  }

  public async set(key: string, resolvedValue: LoadedValue, group: string): Promise<void> {
    this.inMemoryCache.setForGroup(key, resolvedValue, group)
    this.evictGroupRunningLoad(group, key)
    if (this.asyncCache) {
      return this.asyncCache.setForGroup(key, resolvedValue, group).catch((err) => {
        this.cacheUpdateErrorHandler(err, key, this.asyncCache!, this.logger)
      })
    }
  }
}
