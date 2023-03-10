import { AbstractOperation } from './AbstractOperation'

export abstract class AbstractFlatOperation<
  LoadedValue,
  ResolveParams = undefined
> extends AbstractOperation<LoadedValue> {
  public getInMemoryOnly(key: string): LoadedValue | undefined | null {
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
    const inMemoryValue = this.inMemoryCache.get(key)
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
  }
}
