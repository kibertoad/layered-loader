import { AbstractOperation, LoadEntry } from './AbstractOperation'

export abstract class AbstractFlatOperation<LoadedValue> extends AbstractOperation<LoadedValue> {
  public getInMemoryOnly(key: string): LoadedValue | undefined | null {
    return this.inMemoryCache.get(key)
  }

  public async getAsyncOnly(key: string): Promise<LoadedValue | undefined | null> {
    const existingLoad = this.runningLoads.get(key)
    if (existingLoad) {
      existingLoad.counter++
      if (existingLoad.counter > this.maxBatchedOperationsPerLoad) {
        this.runningLoads.delete(key)
      }
      return existingLoad.promise
    }

    const loadingPromise = this.resolveValue(key)
    this.runningLoads.set(key, new LoadEntry(loadingPromise))

    const resolvedValue = await loadingPromise
    if (resolvedValue === undefined) {
      if (this.throwIfUnresolved) {
        this.runningLoads.delete(key)
        throw new Error(`Failed to resolve value for key "${key}"`)
      }
    } else {
      this.inMemoryCache.set(key, resolvedValue)
    }
    this.runningLoads.delete(key)
    return resolvedValue
  }

  public async get(key: string): Promise<LoadedValue | undefined | null> {
    const inMemoryValue = this.inMemoryCache.get(key)
    if (inMemoryValue !== undefined) {
      return inMemoryValue
    }

    return this.getAsyncOnly(key)
  }

  protected async resolveValue(key: string): Promise<LoadedValue | undefined | null> {
    if (this.asyncCache) {
      const cachedValue = await this.asyncCache.get(key).catch((err) => {
        this.loadErrorHandler(err, key, this.asyncCache!, this.logger)
      })
      return cachedValue as LoadedValue | undefined | null
    }

    return undefined
  }
}
