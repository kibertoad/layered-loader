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
    const key = this.cacheKeyFromLoadParamsResolver(loadParams)
    if (this.inMemoryCache.ttlLeftBeforeRefreshInMsecs && !this.runningLoads.has(key)) {
      const expirationTime = this.inMemoryCache.getExpirationTime(key)
      if (expirationTime && expirationTime - Date.now() < this.inMemoryCache.ttlLeftBeforeRefreshInMsecs) {
        void this.getAsyncOnly(loadParams)
      }
    }

    return this.inMemoryCache.get(key)
  }

  public getManyInMemoryOnly(keys: string[]): GetManyResult<LoadedValue> {
    // Note that it doesn't support preemptive refresh
    return this.inMemoryCache.getMany(keys)
  }

  public getAsyncOnly(loadParams: LoadParams): Promise<LoadedValue | undefined | null> {
    const key = this.cacheKeyFromLoadParamsResolver(loadParams)
    const existingLoad = this.runningLoads.get(key)
    if (existingLoad) {
      return existingLoad
    }

    const loadingPromise = this.resolveValue(key, loadParams)
    this.runningLoads.set(key, loadingPromise)

    loadingPromise
      .then((resolvedValue) => {
        if (resolvedValue !== undefined) {
          this.inMemoryCache.set(key, resolvedValue)
        }
        this.runningLoads.delete(key)
      })
      .catch(() => {
        this.runningLoads.delete(key)
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
    const inMemoryValue = this.getInMemoryOnly(loadParams)
    if (inMemoryValue !== undefined) {
      return Promise.resolve(inMemoryValue)
    }

    return this.getAsyncOnly(loadParams)
  }

  public getMany(keys: string[], loadParams?: LoadManyParams): Promise<LoadedValue[]> {
    const uniqueKeys = unique(keys)
    const inMemoryValues = this.getManyInMemoryOnly(uniqueKeys)
    // everything is in memory, hurray
    if (inMemoryValues.unresolvedKeys.length === 0) {
      return Promise.resolve(inMemoryValues.resolvedValues)
    }

    return this.getManyAsyncOnly(inMemoryValues.unresolvedKeys, loadParams).then((asyncRetrievedValues) => {
      return [...inMemoryValues.resolvedValues, ...asyncRetrievedValues.resolvedValues]
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
    this.inMemoryCache.delete(key)
    if (this.asyncCache) {
      await this.asyncCache.delete(key).catch((err) => {
        this.cacheUpdateErrorHandler(err, undefined, this.asyncCache!, this.logger)
      })
    }

    this.runningLoads.delete(key)
    if (this.notificationPublisher) {
      this.notificationPublisher.delete(key).catch((err) => {
        this.notificationPublisher!.errorHandler(err, this.notificationPublisher!.channel, this.logger)
      })
    }
  }

  public async invalidateCacheForMany(keys: string[]) {
    if (this.asyncCache) {
      await this.asyncCache.deleteMany(keys).catch((err) => {
        /* c8 ignore next 1 */
        this.cacheUpdateErrorHandler(err, undefined, this.asyncCache!, this.logger)
      })
    }

    for (let i = 0; i < keys.length; i++) {
      this.inMemoryCache.delete(keys[i])
      this.runningLoads.delete(keys[i])
    }

    if (this.notificationPublisher) {
      this.notificationPublisher.deleteMany(keys).catch((err) => {
        /* c8 ignore next 1 */
        this.notificationPublisher!.errorHandler(err, this.notificationPublisher!.channel, this.logger)
      })
    }
  }
}
