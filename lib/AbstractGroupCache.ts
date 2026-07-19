import { AbstractCache } from './AbstractCache.js'
import type { InMemoryGroupCacheConfiguration } from './memory/InMemoryGroupCache.js'
import type { GroupNotificationPublisher } from './notifications/GroupNotificationPublisher.js'
import type { GroupCache } from './types/DataSources.js'
import type { GetManyResult, SynchronousGroupCache } from './types/SyncDataSources.js'
import {unique} from "./util/unique.js";

export abstract class AbstractGroupCache<LoadedValue, LoadParams = string, LoadManyParams = LoadParams extends string ? undefined : LoadParams> extends AbstractCache<
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
    // Evict the running loads first so in-flight results are fenced out of the caches.
    this.runningLoads.delete(group)
    if (this.asyncCache) {
      await this.asyncCache.deleteGroup(group).catch((err) => {
        this.cacheUpdateErrorHandler(err, `group: ${group}`, this.asyncCache!, this.logger)
      })
    }

    // Evict again: a load that started while the async delete was in flight may have
    // read the not-yet-deleted async value; fencing it out here stops it from
    // repopulating the caches after this invalidation resolves. The in-memory delete
    // comes last for the same reason.
    this.runningLoads.delete(group)
    this.inMemoryCache.deleteGroup(group)

    if (this.notificationPublisher) {
      void this.notificationPublisher.deleteGroup(group).catch((err) => {
        this.notificationPublisher!.errorHandler(err, this.notificationPublisher!.channel, this.logger)
      })
    }
  }

  public getInMemoryOnly(loadParams: LoadParams, group: string): LoadedValue | undefined | null {
    return this.getInMemoryOnlyResolved(this.cacheKeyFromLoadParamsResolver(loadParams), loadParams, group)
  }

  private getInMemoryOnlyResolved(
    key: string,
    loadParams: LoadParams,
    group: string,
  ): LoadedValue | undefined | null {
    if (this.inMemoryCache.ttlLeftBeforeRefreshInMsecs) {
      if (!this.runningLoads.get(group)?.has(key)) {
        const expirationTime = this.inMemoryCache.getExpirationTimeFromGroup(key, group)
        if (expirationTime && expirationTime - Date.now() < this.inMemoryCache.ttlLeftBeforeRefreshInMsecs) {
          this.scheduleInMemoryRefresh(key, loadParams, group)
        }
      }
    }

    return this.inMemoryCache.getFromGroup(key, group)
  }

  /**
   * Kicks off a preemptive in-memory refresh for an entry entering its refresh window. The default
   * runs the blind background reload; subclasses (GroupLoader) may override to run a staleness probe
   * against the in-memory value and merely bump its TTL when it is still current.
   */
  protected scheduleInMemoryRefresh(key: string, loadParams: LoadParams, group: string): void {
    void this.getAsyncOnlyResolved(key, loadParams, group)
  }

  public getManyInMemoryOnly(keys: string[], group: string) {
    // Note that it doesn't support preemptive refresh
    return this.inMemoryCache.getManyFromGroup(keys, group)
  }

  public getAsyncOnly(loadParams: LoadParams, group: string): Promise<LoadedValue | undefined | null> {
    return this.getAsyncOnlyResolved(this.cacheKeyFromLoadParamsResolver(loadParams), loadParams, group)
  }

  protected getAsyncOnlyResolved(
    key: string,
    loadParams: LoadParams,
    group: string,
  ): Promise<LoadedValue | undefined | null> {
    const groupLoads = this.resolveGroupLoads(group)
    const existingLoad = groupLoads.get(key)
    if (existingLoad) {
      return existingLoad
    }

    const loadingPromise = this.resolveGroupValue(key, group, loadParams)
    groupLoads.set(key, loadingPromise)

    loadingPromise
      .then((resolvedValue) => {
        // If the running load was evicted (group or key invalidation) while this load
        // was in flight, its result reflects a snapshot taken before that point and must
        // not be persisted - callers awaiting the promise still receive the value.
        if (this.runningLoads.get(group) !== groupLoads || groupLoads.get(key) !== loadingPromise) {
          return
        }
        if (resolvedValue !== undefined) {
          this.inMemoryCache.setForGroup(key, resolvedValue, group)
        }
        this.deleteGroupRunningLoad(groupLoads, group, key)
      })
      .catch(() => {
        if (this.runningLoads.get(group) === groupLoads && groupLoads.get(key) === loadingPromise) {
          this.deleteGroupRunningLoad(groupLoads, group, key)
        }
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
    const inMemoryValue = this.getInMemoryOnlyResolved(key, loadParams, group)
    if (inMemoryValue !== undefined) {
      return Promise.resolve(inMemoryValue)
    }

    return this.getAsyncOnlyResolved(key, loadParams, group)
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
        // in-memory caches always return a fresh array, so it is safe to append to it in place
        const mergedValues = inMemoryValues.resolvedValues
        for (let i = 0; i < asyncRetrievedValues.resolvedValues.length; i++) {
          mergedValues.push(asyncRetrievedValues.resolvedValues[i])
        }
        return mergedValues
      },
    )
  }

  public async invalidateCacheFor(key: string, group: string) {
    // Evict the running load first so an in-flight result is fenced out of the caches.
    this.evictGroupRunningLoad(group, key)
    if (this.asyncCache) {
      await this.asyncCache.deleteFromGroup(key, group).catch((err) => {
        this.cacheUpdateErrorHandler(err, undefined, this.asyncCache!, this.logger)
      })
    }

    // Evict again: a load that started while the async delete was in flight may have
    // read the not-yet-deleted async value; fencing it out here stops it from
    // repopulating the caches after this invalidation resolves. The in-memory delete
    // comes last for the same reason.
    this.evictGroupRunningLoad(group, key)
    this.inMemoryCache.deleteFromGroup(key, group)

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

  private evictGroupRunningLoad(group: string, key: string) {
    const groupLoads = this.runningLoads.get(group)
    if (groupLoads) {
      this.deleteGroupRunningLoad(groupLoads, group, key)
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
    // Only drop the group entry if it still points at this map - a group invalidation
    // may have detached it and a newer load registered a fresh map under the same group,
    // which must not be evicted by a load settling against the stale map.
    if (groupLoads.size === 0 && this.runningLoads.get(group) === groupLoads) {
      this.runningLoads.delete(group)
    }
  }
}
