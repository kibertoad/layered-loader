import { AbstractCache } from './AbstractCache'
import type { Cache, IdResolver } from './types/DataSources'
import type { GetManyResult, SynchronousCache } from './types/SyncDataSources'

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

  public getManyInMemoryOnly(keys: string[]): GetManyResult<LoadedValue> {
    // ToDo no support for refresh, maybe later
    return this.inMemoryCache.getMany(keys)
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

  public getManyAsyncOnly(keys: string[], idResolver: IdResolver<LoadedValue>, resolveParams?: ResolveParams) {
    // ToDo There is currently no deduplication. What would be a way to implement it without destroying the perf?..

    const loadingPromise = this.resolveManyValues(keys, idResolver, resolveParams)

    loadingPromise
      .then((result) => {
        for (let i = 0; i < result.resolvedValues.length; i++) {
          const resolvedValue = result.resolvedValues[i]
          const id = idResolver(resolvedValue)
          this.inMemoryCache.set(id, resolvedValue)
        }
      })
      .catch(() => {})

    return loadingPromise
  }

  public get(key: string, resolveParams?: ResolveParams): Promise<LoadedValue | undefined | null> {
    const inMemoryValue = this.getInMemoryOnly(key, resolveParams)
    if (inMemoryValue !== undefined) {
      return Promise.resolve(inMemoryValue)
    }

    return this.getAsyncOnly(key, resolveParams)
  }

  public async getMany(
    keys: string[],
    idResolver: IdResolver<LoadedValue>,
    resolveParams?: ResolveParams,
  ): Promise<LoadedValue[]> {
    const inMemoryValues = this.getManyInMemoryOnly(keys)
    // everything is in memory, hurray
    if (inMemoryValues.unresolvedKeys.length === 0) {
      return inMemoryValues.resolvedValues
    }

    const asyncRetrievedValues = await this.getManyAsyncOnly(inMemoryValues.unresolvedKeys, idResolver, resolveParams)

    return [...inMemoryValues.resolvedValues, ...asyncRetrievedValues.resolvedValues]
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

  protected async resolveManyValues(
    keys: string[],
    _idResolver: IdResolver<LoadedValue>,
    _resolveParams?: ResolveParams,
  ): Promise<GetManyResult<LoadedValue>> {
    if (this.asyncCache) {
      return this.asyncCache.getManyCached(keys).catch((err) => {
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
}
