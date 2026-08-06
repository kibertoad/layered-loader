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

  /**
   * Background write fences are keyed by a single string, so a grouped entry needs its group and key
   * flattened into one. Group names and keys are arbitrary strings, so the group is length-prefixed:
   * that makes toGroupFencePrefix an exact group match, rather than one that could also catch a
   * different group whose name happens to start the same way.
   */
  private static toFenceKey(key: string, group: string): string {
    return `${AbstractGroupCache.toGroupFencePrefix(group)}${key}`
  }

  private static toGroupFencePrefix(group: string): string {
    return `${group.length}:${group}:`
  }

  /**
   * Fences everything in flight for a grouped entry: the running load, and any background work that
   * is going to write into the in-memory tier without holding one (the async-tier preemptive
   * refresh). Every invalidation path - originating and applying alike - goes through here.
   */
  protected evictGroupRunningLoad(group: string, key: string): void {
    const groupLoads = this.runningLoads.get(group)
    if (groupLoads) {
      this.deleteGroupRunningLoad(groupLoads, group, key)
    }
    this.breakBackgroundWriteFence(AbstractGroupCache.toFenceKey(key, group))
  }

  /**
   * Group-wide form of evictGroupRunningLoad.
   */
  protected evictGroupRunningLoads(group: string): void {
    this.runningLoads.delete(group)
    this.breakBackgroundWriteFencesWithPrefix(AbstractGroupCache.toGroupFencePrefix(group))
  }

  /**
   * Grouped forms of the background write fence primitives on AbstractCache.
   */
  protected openGroupBackgroundWriteFence(key: string, group: string): number {
    return this.openBackgroundWriteFence(AbstractGroupCache.toFenceKey(key, group))
  }

  protected isGroupBackgroundWriteFenceIntact(key: string, group: string, token: number): boolean {
    return this.isBackgroundWriteFenceIntact(AbstractGroupCache.toFenceKey(key, group), token)
  }

  protected closeGroupBackgroundWriteFence(key: string, group: string, token: number): void {
    this.closeBackgroundWriteFence(AbstractGroupCache.toFenceKey(key, group), token)
  }

  /**
   * Applies an entry invalidation that originated elsewhere - another node on a notification bus, or
   * a pull-based transport that read "what changed since cursor N" at the start of a request.
   *
   * This is deliberately not the same operation as {@link invalidateCacheFor}: it publishes nothing
   * (the origin already broadcast it, and re-publishing would echo it back onto the bus) and does
   * not touch the shared async cache (the origin already deleted the entry there), but it does evict
   * the running load and break the fence of an async-tier preemptive refresh in flight for the
   * entry, so neither can write its pre-invalidation snapshot back into the in-memory cache when it
   * resolves.
   *
   * Notification consumers get this behaviour without doing anything: the target cache they are
   * handed routes deletions through here.
   */
  public applyRemoteInvalidationFor(key: string, group: string): void {
    this.evictGroupRunningLoad(group, key)
    this.inMemoryCache.deleteFromGroup(key, group)
  }

  /**
   * Group-wide form of {@link applyRemoteInvalidationFor}.
   */
  public applyRemoteInvalidationForGroup(group: string): void {
    this.evictGroupRunningLoads(group)
    this.inMemoryCache.deleteGroup(group)
  }

  /**
   * Applies a value that was set elsewhere and broadcast to this node. Fences the running load for
   * the same reason {@link applyRemoteInvalidationFor} does: an older in-flight load must not
   * overwrite the newer value that just arrived.
   */
  public applyRemoteValue(key: string, value: LoadedValue | null, group: string): void {
    this.evictGroupRunningLoad(group, key)
    this.inMemoryCache.setForGroup(key, value, group)
  }

  protected override createRemoteInvalidationTarget(): SynchronousGroupCache<LoadedValue> {
    const inMemoryCache = this.inMemoryCache
    return {
      ttlLeftBeforeRefreshInMsecs: inMemoryCache.ttlLeftBeforeRefreshInMsecs,
      getFromGroup: (key, group) => inMemoryCache.getFromGroup(key, group),
      getManyFromGroup: (keys, group) => inMemoryCache.getManyFromGroup(keys, group),
      getExpirationTimeFromGroup: (key, group) => inMemoryCache.getExpirationTimeFromGroup(key, group),
      resetTtlFromGroup: (key, group) => inMemoryCache.resetTtlFromGroup(key, group),
      setForGroup: (key, value, group) => this.applyRemoteValue(key, value, group),
      deleteFromGroup: (key, group) => this.applyRemoteInvalidationFor(key, group),
      deleteGroup: (group) => this.applyRemoteInvalidationForGroup(group),
      clear: () => this.applyRemoteInvalidation(),
    }
  }

  public async invalidateCacheForGroup(group: string) {
    // Evict the running loads first so in-flight results are fenced out of the caches.
    this.evictGroupRunningLoads(group)
    if (this.asyncCache) {
      await this.asyncCache.deleteGroup(group).catch((err) => {
        this.cacheUpdateErrorHandler(err, `group: ${group}`, this.asyncCache!, this.logger)
      })
    }

    // Evict again: a load that started while the async delete was in flight may have
    // read the not-yet-deleted async value; fencing it out here stops it from
    // repopulating the caches after this invalidation resolves. The in-memory delete
    // comes last for the same reason.
    this.evictGroupRunningLoads(group)
    this.inMemoryCache.deleteGroup(group)

    if (this.notificationPublisher) {
      this.runInBackground(
        this.notificationPublisher.deleteGroup(group).catch((err) => {
          this.notificationPublisher!.errorHandler(err, this.notificationPublisher!.channel, this.logger)
        }),
        'notification',
      )
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
    this.runInBackground(this.getAsyncOnlyResolved(key, loadParams, group), 'refresh')
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
      this.runInBackground(
        this.notificationPublisher.deleteFromGroup(key, group).catch((err) => {
          this.notificationPublisher!.errorHandler(err, this.notificationPublisher!.channel, this.logger)
        }),
        'notification',
      )
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
    // Only drop the group entry if it still points at this map - a group invalidation
    // may have detached it and a newer load registered a fresh map under the same group,
    // which must not be evicted by a load settling against the stale map.
    if (groupLoads.size === 0 && this.runningLoads.get(group) === groupLoads) {
      this.runningLoads.delete(group)
    }
  }
}
