import { AbstractCache } from './AbstractCache'
import type { Cache } from './types/DataSources'
import type { SynchronousCache } from './types/SyncDataSources'

export abstract class AbstractFlatCache<LoadedValue, ResolveParams = undefined> extends AbstractCache<
  LoadedValue,
  Promise<LoadedValue | undefined | null> | undefined,
  Cache<LoadedValue>,
  SynchronousCache<LoadedValue>
> {
  override isGroupCache() {
    return false
  }

  public getInMemoryOnly(key: string, resolveParams?: ResolveParams): LoadedValue | undefined | null {
    if (this.inMemoryCache.ttlLeftBeforeRefreshInMsecs && !this.runningLoads.has(key)) {
      const expirationTime = this.inMemoryCache.getExpirationTime(key)
      if (expirationTime && expirationTime - Date.now() < this.inMemoryCache.ttlLeftBeforeRefreshInMsecs) {
        void this.getAsyncOnly(key, resolveParams)
      }
    }

    return this.inMemoryCache.get(key)
  }

  public getAsyncOnly(key: string, resolveParams?: ResolveParams): Promise<LoadedValue | undefined | null> {
    const existingLoad = this.runningLoads.get(key)
    if (existingLoad) {
      return existingLoad
    }

    const loadingPromise = this.resolveValue(key, resolveParams)
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

  public get(key: string, resolveParams?: ResolveParams): Promise<LoadedValue | undefined | null> {
    const inMemoryValue = this.getInMemoryOnly(key, resolveParams)
    if (inMemoryValue !== undefined) {
      return Promise.resolve(inMemoryValue)
    }

    return this.getAsyncOnly(key, resolveParams)
  }

  protected async resolveValue(key: string, _resolveParams?: ResolveParams): Promise<LoadedValue | undefined | null> {
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

  public async invalidateCacheFor(key: string) {
    this.inMemoryCache.delete(key)
    if (this.asyncCache) {
      await this.asyncCache.delete(key).catch((err) => {
        this.cacheUpdateErrorHandler(err, undefined, this.asyncCache!, this.logger)
      })
    }

    this.runningLoads.delete(key)
    if (this.notificationPublisher) {
      void this.notificationPublisher.delete(key)
    }
  }
}
