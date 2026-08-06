import {AbstractCache} from './AbstractCache.js'
import type { Cache } from './types/DataSources.js'
import type { GetManyResult, SynchronousCache } from './types/SyncDataSources.js'
import {InMemoryCacheConfiguration} from "./memory/InMemoryCache.js";
import {NotificationPublisher} from "./notifications/NotificationPublisher.js";
import {unique} from "./util/unique.js";

export abstract class AbstractFlatCache<LoadedValue, LoadParams = string, LoadManyParams = LoadParams extends string ? undefined : LoadParams> extends AbstractCache<
  LoadedValue,
  Promise<LoadedValue | undefined | null> | undefined,
  Cache<LoadedValue>,
  SynchronousCache<LoadedValue>,
  InMemoryCacheConfiguration,
  NotificationPublisher<LoadedValue>,
  LoadParams
> {

  override isGroupCache() {
    return false
  }

  /**
   * Fences everything in flight for a key: the running load, and any background work that is going
   * to write into the in-memory tier without holding a running load (the async-tier preemptive
   * refresh). Every invalidation path - originating and applying alike - goes through here.
   *
   * Deliberately not used by the load-completion bookkeeping in {@link getAsyncOnlyResolved}: a load
   * finishing normally must not cancel a concurrent refresh that is about to write a fresher value.
   */
  protected evictRunningLoad(key: string): void {
    this.runningLoads.delete(key)
    this.breakBackgroundWriteFence(key)
  }

  /**
   * Applies an invalidation that originated elsewhere - another node on a notification bus, or a
   * pull-based transport that read "what changed since cursor N" at the start of a request.
   *
   * This is deliberately not the same operation as {@link invalidateCacheFor}:
   *
   * - it publishes nothing, because the origin already broadcast the invalidation; re-publishing it
   *   would echo it back onto the bus;
   * - it does not touch the async cache, because that tier is shared and the origin already deleted
   *   the entry there;
   * - it does evict the running load for the key, and breaks the fence of an async-tier preemptive
   *   refresh in flight for it, so neither can write its pre-invalidation snapshot back into the
   *   in-memory cache when it resolves. Callers already awaiting that load still receive its value,
   *   exactly as they do for a locally originated invalidation.
   *
   * Notification consumers get this behaviour without doing anything: the target cache they are
   * handed routes deletions through here.
   */
  public applyRemoteInvalidationFor(key: string): void {
    this.evictRunningLoad(key)
    this.inMemoryCache.delete(key)
  }

  /**
   * Batch form of {@link applyRemoteInvalidationFor}.
   */
  public applyRemoteInvalidationForMany(keys: string[]): void {
    for (let i = 0; i < keys.length; i++) {
      this.evictRunningLoad(keys[i])
    }
    this.inMemoryCache.deleteMany(keys)
  }

  /**
   * Applies a value that was set elsewhere and broadcast to this node. Fences the running load for
   * the same reason {@link applyRemoteInvalidationFor} does: an older in-flight load must not
   * overwrite the newer value that just arrived.
   */
  public applyRemoteValue(key: string, value: LoadedValue | null): void {
    this.evictRunningLoad(key)
    this.inMemoryCache.set(key, value)
  }

  protected override createRemoteInvalidationTarget(): SynchronousCache<LoadedValue> {
    const inMemoryCache = this.inMemoryCache
    return {
      ttlLeftBeforeRefreshInMsecs: inMemoryCache.ttlLeftBeforeRefreshInMsecs,
      get: (key) => inMemoryCache.get(key),
      getMany: (keys) => inMemoryCache.getMany(keys),
      getExpirationTime: (key) => inMemoryCache.getExpirationTime(key),
      resetTtl: (key) => inMemoryCache.resetTtl(key),
      set: (key, value) => this.applyRemoteValue(key, value),
      delete: (key) => this.applyRemoteInvalidationFor(key),
      deleteMany: (keys) => this.applyRemoteInvalidationForMany(keys),
      clear: () => this.applyRemoteInvalidation(),
    }
  }

  public getInMemoryOnly(loadParams: LoadParams): LoadedValue | undefined | null {
    return this.getInMemoryOnlyResolved(this.cacheKeyFromLoadParamsResolver(loadParams), loadParams)
  }

  private getInMemoryOnlyResolved(key: string, loadParams: LoadParams): LoadedValue | undefined | null {
    if (this.inMemoryCache.ttlLeftBeforeRefreshInMsecs && !this.runningLoads.has(key)) {
      const expirationTime = this.inMemoryCache.getExpirationTime(key)
      if (expirationTime && expirationTime - Date.now() < this.inMemoryCache.ttlLeftBeforeRefreshInMsecs) {
        this.scheduleInMemoryRefresh(key, loadParams)
      }
    }

    return this.inMemoryCache.get(key)
  }

  /**
   * Kicks off a preemptive in-memory refresh for an entry entering its refresh window. The default
   * runs the blind background reload; subclasses (Loader) may override to run a staleness probe
   * against the in-memory value and merely bump its TTL when it is still current.
   */
  protected scheduleInMemoryRefresh(key: string, loadParams: LoadParams): void {
    this.runInBackground(this.getAsyncOnlyResolved(key, loadParams), 'refresh')
  }

  public getManyInMemoryOnly(keys: string[]): GetManyResult<LoadedValue> {
    // Note that it doesn't support preemptive refresh
    return this.inMemoryCache.getMany(keys)
  }

  public getAsyncOnly(loadParams: LoadParams): Promise<LoadedValue | undefined | null> {
    return this.getAsyncOnlyResolved(this.cacheKeyFromLoadParamsResolver(loadParams), loadParams)
  }

  protected getAsyncOnlyResolved(key: string, loadParams: LoadParams): Promise<LoadedValue | undefined | null> {
    const existingLoad = this.runningLoads.get(key)
    if (existingLoad) {
      return existingLoad
    }

    const loadingPromise = this.resolveValue(key, loadParams)
    this.runningLoads.set(key, loadingPromise)

    loadingPromise
      .then((resolvedValue) => {
        // If the running load was evicted (invalidation, forceSetValue) while this load
        // was in flight, its result reflects a snapshot taken before that point and must
        // not be persisted - callers awaiting the promise still receive the value.
        if (this.runningLoads.get(key) !== loadingPromise) {
          return
        }
        if (resolvedValue !== undefined) {
          this.inMemoryCache.set(key, resolvedValue)
        }
        this.runningLoads.delete(key)
      })
      .catch(() => {
        if (this.runningLoads.get(key) === loadingPromise) {
          this.runningLoads.delete(key)
        }
      })

    return loadingPromise
  }

  public getManyAsyncOnly(
    keys: string[],
    loadParams?: LoadManyParams,
  ): Promise<GetManyResult<LoadedValue>> {
    // This doesn't support deduplication, and never might, as that would affect perf strongly. Maybe as an opt-in option in the future?
    const loadingPromise = this.resolveManyValues(keys, loadParams)

    return loadingPromise.then((result) => {
      for (let i = 0; i < result.resolvedValues.length; i++) {
        const resolvedValue = result.resolvedValues[i]
        const id = this.cacheKeyFromValueResolver(resolvedValue)
        this.inMemoryCache.set(id, resolvedValue)
      }
      return result
    })
  }

  public get(loadParams: LoadParams): Promise<LoadedValue | undefined | null> {
    const key = this.cacheKeyFromLoadParamsResolver(loadParams)
    const inMemoryValue = this.getInMemoryOnlyResolved(key, loadParams)
    if (inMemoryValue !== undefined) {
      return Promise.resolve(inMemoryValue)
    }

    return this.getAsyncOnlyResolved(key, loadParams)
  }

  public getMany(keys: string[], loadParams?: LoadManyParams): Promise<LoadedValue[]> {
    const uniqueKeys = unique(keys)
    const inMemoryValues = this.getManyInMemoryOnly(uniqueKeys)
    // everything is in memory, hurray
    if (inMemoryValues.unresolvedKeys.length === 0) {
      return Promise.resolve(inMemoryValues.resolvedValues)
    }

    return this.getManyAsyncOnly(inMemoryValues.unresolvedKeys, loadParams).then((asyncRetrievedValues) => {
      // in-memory caches always return a fresh array, so it is safe to append to it in place
      const mergedValues = inMemoryValues.resolvedValues
      for (let i = 0; i < asyncRetrievedValues.resolvedValues.length; i++) {
        mergedValues.push(asyncRetrievedValues.resolvedValues[i])
      }
      return mergedValues
    })
  }

  protected async resolveValue(key: string, _loadParams: LoadParams): Promise<LoadedValue | undefined | null> {
    if (this.asyncCache) {
      const cachedValue = await this.asyncCache.get(key).catch((err) => {
        this.loadErrorHandler(err, key, this.asyncCache!, this.logger)
      })
      if (cachedValue !== undefined) {
        return cachedValue as LoadedValue | undefined | null
      }
    }
    return undefined
  }

  protected async resolveManyValues(
    keys: string[],
    _loadParams?: LoadManyParams,
  ): Promise<GetManyResult<LoadedValue>> {
    if (this.asyncCache) {
      return this.asyncCache.getMany(keys).catch((err) => {
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

  public async invalidateCacheFor(key: string) {
    // Evict the running load first so an in-flight result is fenced out of the caches.
    this.evictRunningLoad(key)
    if (this.asyncCache) {
      await this.asyncCache.delete(key).catch((err) => {
        this.cacheUpdateErrorHandler(err, undefined, this.asyncCache!, this.logger)
      })
    }

    // Evict again: a load that started while the async delete was in flight may have
    // read the not-yet-deleted async value; fencing it out here stops it from
    // repopulating the caches after this invalidation resolves. The in-memory delete
    // comes last for the same reason.
    this.evictRunningLoad(key)
    this.inMemoryCache.delete(key)
    if (this.notificationPublisher) {
      this.runInBackground(
        this.notificationPublisher.delete(key).catch((err) => {
          this.notificationPublisher!.errorHandler(err, this.notificationPublisher!.channel, this.logger)
        }),
        'notification',
      )
    }
  }

  public async invalidateCacheForMany(keys: string[]) {
    // Evict the running loads first so in-flight results are fenced out of the caches.
    for (let i = 0; i < keys.length; i++) {
      this.evictRunningLoad(keys[i])
    }
    if (this.asyncCache) {
      await this.asyncCache.deleteMany(keys).catch((err) => {
        /* v8 ignore next -- @preserve */
        this.cacheUpdateErrorHandler(err, undefined, this.asyncCache!, this.logger)
      })
    }

    for (let i = 0; i < keys.length; i++) {
      this.inMemoryCache.delete(keys[i])
      this.evictRunningLoad(keys[i])
    }

    if (this.notificationPublisher) {
      this.runInBackground(
        this.notificationPublisher.deleteMany(keys).catch((err) => {
          /* v8 ignore next -- @preserve */
          this.notificationPublisher!.errorHandler(err, this.notificationPublisher!.channel, this.logger)
        }),
        'notification',
      )
    }
  }
}
