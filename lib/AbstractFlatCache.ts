import {AbstractCache} from './AbstractCache'
import type { Cache } from './types/DataSources'
import type { GetManyResult, SynchronousCache } from './types/SyncDataSources'
import {InMemoryCacheConfiguration} from "./memory/InMemoryCache";
import {NotificationPublisher} from "./notifications/NotificationPublisher";
import {unique} from "./util/unique";

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

  public getInMemoryOnly(loadParams: LoadParams): LoadedValue | undefined | null {
    return this.getInMemoryOnlyResolved(this.cacheKeyFromLoadParamsResolver(loadParams), loadParams)
  }

  private getInMemoryOnlyResolved(key: string, loadParams: LoadParams): LoadedValue | undefined | null {
    if (this.inMemoryCache.ttlLeftBeforeRefreshInMsecs && !this.runningLoads.has(key)) {
      const expirationTime = this.inMemoryCache.getExpirationTime(key)
      if (expirationTime && expirationTime - Date.now() < this.inMemoryCache.ttlLeftBeforeRefreshInMsecs) {
        void this.getAsyncOnlyResolved(key, loadParams)
      }
    }

    return this.inMemoryCache.get(key)
  }

  public getManyInMemoryOnly(keys: string[]): GetManyResult<LoadedValue> {
    // Note that it doesn't support preemptive refresh
    return this.inMemoryCache.getMany(keys)
  }

  public getAsyncOnly(loadParams: LoadParams): Promise<LoadedValue | undefined | null> {
    return this.getAsyncOnlyResolved(this.cacheKeyFromLoadParamsResolver(loadParams), loadParams)
  }

  private getAsyncOnlyResolved(key: string, loadParams: LoadParams): Promise<LoadedValue | undefined | null> {
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
    this.runningLoads.delete(key)
    if (this.asyncCache) {
      await this.asyncCache.delete(key).catch((err) => {
        this.cacheUpdateErrorHandler(err, undefined, this.asyncCache!, this.logger)
      })
    }

    // Evict again: a load that started while the async delete was in flight may have
    // read the not-yet-deleted async value; fencing it out here stops it from
    // repopulating the caches after this invalidation resolves. The in-memory delete
    // comes last for the same reason.
    this.runningLoads.delete(key)
    this.inMemoryCache.delete(key)
    if (this.notificationPublisher) {
      this.notificationPublisher.delete(key).catch((err) => {
        this.notificationPublisher!.errorHandler(err, this.notificationPublisher!.channel, this.logger)
      })
    }
  }

  public async invalidateCacheForMany(keys: string[]) {
    // Evict the running loads first so in-flight results are fenced out of the caches.
    for (let i = 0; i < keys.length; i++) {
      this.runningLoads.delete(keys[i])
    }
    if (this.asyncCache) {
      await this.asyncCache.deleteMany(keys).catch((err) => {
        /* v8 ignore next -- @preserve */
        this.cacheUpdateErrorHandler(err, undefined, this.asyncCache!, this.logger)
      })
    }

    for (let i = 0; i < keys.length; i++) {
      this.inMemoryCache.delete(keys[i])
      this.runningLoads.delete(keys[i])
    }

    if (this.notificationPublisher) {
      this.notificationPublisher.deleteMany(keys).catch((err) => {
        /* v8 ignore next -- @preserve */
        this.notificationPublisher!.errorHandler(err, this.notificationPublisher!.channel, this.logger)
      })
    }
  }
}
