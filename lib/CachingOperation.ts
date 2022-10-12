import { Cache } from './DataSources'
import { DEFAULT_CACHE_ERROR_HANDLER, DEFAULT_LOAD_ERROR_HANDLER, LoaderErrorHandler } from './LoadingOperation'
import { defaultLogger, Logger } from './Logger'
import { LRU, lru } from 'tiny-lru'

export type CachingOperationConfig = {
  logger: Logger
  cacheUpdateErrorHandler: LoaderErrorHandler
  loadErrorHandler: LoaderErrorHandler
  loadingOperationMemorySize: number
  loadingOperationMememoryTtl: number
}

const DEFAULT_CONFIG: CachingOperationConfig = {
  logger: defaultLogger,
  cacheUpdateErrorHandler: DEFAULT_CACHE_ERROR_HANDLER,
  loadErrorHandler: DEFAULT_LOAD_ERROR_HANDLER,
  loadingOperationMemorySize: 100,
  loadingOperationMememoryTtl: 1000 * 30,
}

export class CachingOperation<LoadedValue> {
  private readonly params: CachingOperationConfig
  private readonly caches: readonly Cache<LoadedValue>[]
  private readonly cacheIndexes: readonly number[]
  private readonly runningLoads: LRU<Promise<LoadedValue | undefined | null> | undefined>

  constructor(caches: readonly Cache<LoadedValue>[], params: Partial<CachingOperationConfig> = DEFAULT_CONFIG) {
    this.params = {
      ...DEFAULT_CONFIG,
      ...params,
    }
    this.caches = caches
    this.runningLoads = lru(params.loadingOperationMemorySize, params.loadingOperationMememoryTtl)
    this.cacheIndexes = caches.reduce((result, _value, index) => {
      result.push(index)
      return result
    }, [] as number[])
  }

  public invalidateCache() {
    const promises: Promise<any>[] = []
    this.runningLoads.clear()

    this.cacheIndexes.forEach((cacheIndex) => {
      promises.push(
        Promise.resolve()
          .then(() => {
            return (this.caches[cacheIndex] as unknown as Cache<LoadedValue>).clear()
          })
          .catch((err) => {
            this.params.cacheUpdateErrorHandler(err, undefined, this.caches[cacheIndex], this.params.logger)
          })
      )
    })

    return Promise.all(promises)
  }

  public invalidateCacheFor(key: string) {
    const promises: Promise<any>[] = []
    this.runningLoads.delete(key)

    this.cacheIndexes.forEach((cacheIndex) => {
      promises.push(
        Promise.resolve()
          .then(() => {
            return (this.caches[cacheIndex] as unknown as Cache<LoadedValue>).delete(key)
          })
          .catch((err) => {
            this.params.cacheUpdateErrorHandler(err, key, this.caches[cacheIndex], this.params.logger)
          })
      )
    })
    return Promise.all(promises)
  }

  private async resolveValue(key: string): Promise<LoadedValue | undefined | null> {
    for (let index = 0; index < this.caches.length; index++) {
      const resolvedValue = await Promise.resolve()
        .then(() => {
          return this.caches[index].get(key)
        })
        .catch((err) => {
          this.params.loadErrorHandler(err, key, this.caches[index], this.params.logger)

          // if last loader, fail
          if (index === this.caches.length - 1) {
            throw new Error(`Failed to resolve value for key "${key}": ${err.message}`, { cause: err })
          }
        })

      if (resolvedValue) {
        // update caches
        this.cacheIndexes
          .filter((cacheIndex) => {
            return cacheIndex < index
          })
          .forEach((cacheIndex) => {
            Promise.resolve()
              .then(() => {
                return (this.caches[cacheIndex] as unknown as Cache<LoadedValue>).set(key, resolvedValue)
              })
              .catch((err) => {
                this.params.cacheUpdateErrorHandler(err, key, this.caches[cacheIndex], this.params.logger)
              })
          })

        return resolvedValue
      }
    }
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
    this.runningLoads.delete(key)

    for (let cache of this.caches) {
      const promise = Promise.resolve()
        .then(() => {
          return cache.set(key, resolvedValue)
        })
        .catch((err) => {
          this.params.cacheUpdateErrorHandler(err, key, cache, this.params.logger)
        })
      promises.push(promise)
    }
    await Promise.all(promises)
  }
}