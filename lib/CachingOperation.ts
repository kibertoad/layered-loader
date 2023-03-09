import { AbstractFlatOperation } from './AbstractFlatOperation'

export class CachingOperation<LoadedValue> extends AbstractFlatOperation<LoadedValue> {
  protected readonly runningSetAsyncLoads: Map<string, Promise<LoadedValue>> = new Map()

  public async set(key: string, newValue: LoadedValue): Promise<void> {
    this.inMemoryCache.set(key, newValue)
    this.runningLoads.delete(key)
    if (this.asyncCache) {
      await this.asyncCache.set(key, newValue).catch((err) => {
        this.cacheUpdateErrorHandler(err, key, this.asyncCache!, this.logger)
      })
    }
  }
  public setAsync(key: string, newValueFn: () => Promise<LoadedValue>): Promise<LoadedValue> {
    const existingLoad = this.runningSetAsyncLoads.get(key)
    if (existingLoad) {
      return existingLoad
    }

    const resolverAndSetPromise = new Promise<LoadedValue>((resolve, reject) => {
      const cacheValueResolver = newValueFn()
      cacheValueResolver
        .then((resolvedValue) => {
          this.runningSetAsyncLoads.delete(key)
          this.set(key, resolvedValue).finally(() => {
            resolve(resolvedValue)
          })
        })
        .catch((err) => {
          this.runningSetAsyncLoads.delete(key)
          reject(err)
        })
    })
    this.runningSetAsyncLoads.set(key, resolverAndSetPromise)
    return resolverAndSetPromise
  }
}
