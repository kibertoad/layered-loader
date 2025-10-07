import { AbstractCache } from './AbstractCache'
import type { InMemoryGroupCacheConfiguration } from './memory/InMemoryGroupCache'
import type { GroupNotificationPublisher } from './notifications/GroupNotificationPublisher'
import type { GroupCache } from './types/DataSources'
import type { GetManyResult, SynchronousGroupCache } from './types/SyncDataSources'
import {unique} from "./util/unique";

export abstract class AbstractGroupCache<LoadedValue, LoadParams = string, LoadManyParams = LoadParams> extends AbstractCache<
  LoadedValue,
  Map<string, Promise<LoadedValue | undefined | null> | undefined>,
  GroupCache<LoadedValue>,
  SynchronousGroupCache<LoadedValue>,
  InMemoryGroupCacheConfiguration,
  GroupNotificationPublisher<LoadedValue>,
  LoadParams
> {
  override isGroupCache() {
    return true
  }

  public async invalidateCacheForGroup(group: string) {
    if (this.asyncCache) {
      await this.asyncCache.deleteGroup(group).catch((err) => {
        this.cacheUpdateErrorHandler(err, `group: ${group}`, this.asyncCache!, this.logger)
      })
    }

    this.inMemoryCache.deleteGroup(group)
    this.runningLoads.delete(group)

    if (this.notificationPublisher) {
      void this.notificationPublisher.deleteGroup(group).catch((err) => {
        this.notificationPublisher!.errorHandler(err, this.notificationPublisher!.channel, this.logger)
      })
    }
  }

  public getInMemoryOnly(loadParams: LoadParams, group: string): LoadedValue | undefined | null {
    const key = this.cacheKeyFromLoadParamsResolver(loadParams)
    if (this.inMemoryCache.ttlLeftBeforeRefreshInMsecs) {
      const groupLoads = this.resolveGroupLoads(group)
      if (!groupLoads.has(key)) {
        const expirationTime = this.inMemoryCache.getExpirationTimeFromGroup(key, group)
        if (expirationTime && expirationTime - Date.now() < this.inMemoryCache.ttlLeftBeforeRefreshInMsecs) {
          void this.getAsyncOnly(loadParams, group)
        }
      }
    }

    return this.inMemoryCache.getFromGroup(key, group)
  }

  public getManyInMemoryOnly(keys: string[], group: string) {
    // Note that it doesn't support preemptive refresh
    return this.inMemoryCache.getManyFromGroup(keys, group)
  }

  public getAsyncOnly(loadParams: LoadParams, group: string): Promise<LoadedValue | undefined | null> {
    const key = this.cacheKeyFromLoadParamsResolver(loadParams)
    const groupLoads = this.resolveGroupLoads(group)
    const existingLoad = groupLoads.get(key)
    if (existingLoad) {
      return existingLoad
    }

    const loadingPromise = this.resolveGroupValue(key, group, loadParams)
    groupLoads.set(key, loadingPromise)

    loadingPromise
      .then((resolvedValue) => {
        if (resolvedValue !== undefined) {
          this.inMemoryCache.setForGroup(key, resolvedValue, group)
        }
        this.deleteGroupRunningLoad(groupLoads, group, key)
      })
      .catch(() => {
        this.deleteGroupRunningLoad(groupLoads, group, key)
      })

    return loadingPromise
  }

  public getManyAsyncOnly(
    keys: string[],
    group: string,
    loadParams?: LoadManyParams,
  ): Promise<GetManyResult<LoadedValue>> {
    // Deduplication is handled at the getMany level for optimal performance
    return this.resolveManyGroupValues(keys, group, loadParams).then((result) => {
      for (let i = 0; i < result.resolvedValues.length; i++) {
        const resolvedValue = result.resolvedValues[i]
        const id = this.cacheKeyFromValueResolver(resolvedValue)
        this.inMemoryCache.setForGroup(id, resolvedValue, group)
      }
      return result
    })
  }

  public get(loadParams: LoadParams, group: string): Promise<LoadedValue | undefined | null> {
    const key = this.cacheKeyFromLoadParamsResolver(loadParams)
    const inMemoryValue = this.getInMemoryOnly(loadParams, group)
    if (inMemoryValue !== undefined) {
      return Promise.resolve(inMemoryValue)
    }

    return this.getAsyncOnly(loadParams, group)
  }

  public getMany(
    keys: string[],
    group: string,
    loadParams?: LoadManyParams,
  ): Promise<LoadedValue[]> {
    const uniqueKeys = unique(keys)
    const inMemoryValues = this.getManyInMemoryOnly(uniqueKeys, group)
    // everything is in memory, hurray
    if (inMemoryValues.unresolvedKeys.length === 0) {
      return Promise.resolve(inMemoryValues.resolvedValues)
    }

    return this.getManyAsyncOnly(inMemoryValues.unresolvedKeys, group, loadParams).then(
      (asyncRetrievedValues) => {
        return [...inMemoryValues.resolvedValues, ...asyncRetrievedValues.resolvedValues]
      },
    )
  }

  public async invalidateCacheFor(key: string, group: string) {
    this.inMemoryCache.deleteFromGroup(key, group)
    if (this.asyncCache) {
      await this.asyncCache.deleteFromGroup(key, group).catch((err) => {
        this.cacheUpdateErrorHandler(err, undefined, this.asyncCache!, this.logger)
      })
    }

    const groupLoads = this.resolveGroupLoads(group)
    this.deleteGroupRunningLoad(groupLoads, group, key)

    if (this.notificationPublisher) {
      void this.notificationPublisher.deleteFromGroup(key, group).catch((err) => {
        this.notificationPublisher!.errorHandler(err, this.notificationPublisher!.channel, this.logger)
      })
    }
  }

  protected async resolveGroupValue(
    key: string,
    group: string,
    _loadParams?: LoadParams,
  ): Promise<LoadedValue | undefined | null> {
    if (this.asyncCache) {
      const cachedValue = await this.asyncCache.getFromGroup(key, group).catch((err) => {
        this.loadErrorHandler(err, key, this.asyncCache!, this.logger)
      })
      if (cachedValue !== undefined) {
        return cachedValue as LoadedValue | undefined | null
      }
    }
    return undefined
  }

  protected async resolveManyGroupValues(
    keys: string[],
    group: string,
    _loadParams?: LoadManyParams,
  ) {
    if (this.asyncCache) {
      return this.asyncCache.getManyFromGroup(keys, group).catch((err) => {
        this.loadErrorHandler(err, keys.toString(), this.asyncCache!, this.logger)
        return {
          unresolvedKeys: keys,
          resolvedValues: [],
        }
      })
    }
    return {
      unresolvedKeys: keys,
      resolvedValues: [],
    }
  }

  protected resolveGroupLoads(group: string) {
    const load = this.runningLoads.get(group)
    if (load) {
      return load
    }

    const loadCache = new Map()
    this.runningLoads.set(group, loadCache)
    return loadCache
  }

  protected deleteGroupRunningLoad(groupLoads: Map<string, unknown>, group: string, key: string) {
    groupLoads.delete(key)
    if (groupLoads.size === 0) {
      this.runningLoads.delete(group)
    }
  }
}
