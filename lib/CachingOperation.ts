import { Cache } from './types/DataSources'
import { defaultLogger, Logger } from './Logger'
import { DEFAULT_CACHE_ERROR_HANDLER, DEFAULT_LOAD_ERROR_HANDLER, LoaderErrorHandler } from './AbstractOperation'

export type CachingOperationConfig = {
  logger: Logger
  cacheUpdateErrorHandler: LoaderErrorHandler
  loadErrorHandler: LoaderErrorHandler
}

export const DEFAULT_CACHING_OPERATION_CONFIG: CachingOperationConfig = {
  logger: defaultLogger,
  cacheUpdateErrorHandler: DEFAULT_CACHE_ERROR_HANDLER,
  loadErrorHandler: DEFAULT_LOAD_ERROR_HANDLER,
}

export class CachingOperation<LoadedValue> {
  private readonly params: CachingOperationConfig
  private readonly caches: readonly Cache<LoadedValue>[]
  private readonly cacheIndexes: readonly number[]
  private readonly runningLoads: Map<string, Promise<LoadedValue | undefined | null> | undefined>

  constructor(
    caches: readonly Cache<LoadedValue>[],
    params: Partial<CachingOperationConfig> = DEFAULT_CACHING_OPERATION_CONFIG
  ) {
    this.params = {
      ...DEFAULT_CACHING_OPERATION_CONFIG,
      ...params,
    }
    this.caches = caches
    this.runningLoads = new Map()
    this.cacheIndexes = caches.reduce((result, _value, index) => {
      result.push(index)
      return result
    }, [] as number[])
  }

  public async invalidateCache() {
    const promises: Promise<any>[] = []
    this.cacheIndexes.forEach((cacheIndex) => {
      promises.push(
        this.caches[cacheIndex].clear().catch((err) => {
          this.params.cacheUpdateErrorHandler(err, undefined, this.caches[cacheIndex], this.params.logger)
        })
      )
    })

    await Promise.all(promises)
    this.runningLoads.clear()
  }

  public async invalidateCacheFor(key: string) {
    const promises: Promise<any>[] = []
    this.cacheIndexes.forEach((cacheIndex) => {
      promises.push(
        this.caches[cacheIndex].delete(key).catch((err) => {
          this.params.cacheUpdateErrorHandler(err, key, this.caches[cacheIndex], this.params.logger)
        })
      )
    })
    await Promise.all(promises)
    this.runningLoads.delete(key)
  }

  private async resolveValue(key: string): Promise<LoadedValue | undefined | null> {
    for (let index = 0; index < this.caches.length; index++) {
      const resolvedValue = await this.caches[index].get(key).catch((err) => {
        this.params.loadErrorHandler(err, key, this.caches[index], this.params.logger)

        // if last loader, fail
        if (index === this.caches.length - 1) {
          throw new Error(`Failed to resolve value for key "${key}": ${err.message}`, { cause: err })
        }
      })

      if (resolvedValue !== undefined) {
        const updatePromises = []
        // update caches
        for (var cacheIndex = 0; cacheIndex < index; cacheIndex++) {
          updatePromises.push(
            this.caches[cacheIndex].set(key, resolvedValue).catch((err) => {
              this.params.cacheUpdateErrorHandler(err, key, this.caches[cacheIndex], this.params.logger)
            })
          )
        }
        await Promise.all(updatePromises)
        this.runningLoads.delete(key)

        return resolvedValue
      }
    }
    this.runningLoads.delete(key)
    return undefined
  }

  public async get(key: string): Promise<LoadedValue | undefined | null> {
    const existingLoad = this.runningLoads.get(key)
    if (existingLoad) {
      return existingLoad
    }

    const loadingPromise = this.resolveValue(key)
    this.runningLoads.set(key, loadingPromise)
    return loadingPromise
  }

  public async set(key: string, resolvedValue: LoadedValue): Promise<void> {
    const promises = []
    for (let cache of this.caches) {
      const promise = cache.set(key, resolvedValue).catch((err) => {
        this.params.cacheUpdateErrorHandler(err, key, cache, this.params.logger)
      })
      promises.push(promise)
    }
    await Promise.all(promises)
    this.runningLoads.delete(key)
  }
}
