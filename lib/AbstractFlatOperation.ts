import { AbstractOperation } from './AbstractOperation'

export abstract class AbstractFlatOperation<T> extends AbstractOperation<T> {
  public async get(key: string): Promise<T | undefined | null> {
    const inMemoryValue = this.inMemoryCache.get(key)
    if (inMemoryValue) {
      return inMemoryValue
    }

    const existingLoad = this.runningLoads.get(key)
    if (existingLoad) {
      return existingLoad
    }

    const loadingPromise = this.resolveValue(key)
    this.runningLoads.set(key, loadingPromise)

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

  protected async resolveValue(key: string): Promise<T | undefined | null> {
    if (this.asyncCache) {
      const cachedValue = await this.asyncCache.get(key).catch((err) => {
        this.loadErrorHandler(err, key, this.asyncCache!, this.logger)
      })
      if (cachedValue !== undefined) {
        return cachedValue
      }
    }

    return undefined
  }
}
