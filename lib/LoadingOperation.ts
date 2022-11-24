import { Loader, Cache } from './DataSources'
import { defaultLogger, Logger } from './Logger'
import { lru, LRU } from 'tiny-lru'

export type LoadingOperationConfig = {
  logger: Logger
  throwIfUnresolved: boolean
  cacheUpdateErrorHandler: LoaderErrorHandler
  loadErrorHandler: LoaderErrorHandler
  loadingOperationMemorySize: number
  loadingOperationMemoryTtl: number
}

export type LoaderErrorHandler = (err: Error, key: string | undefined, loader: Loader<any>, logger: Logger) => void

export const DEFAULT_LOAD_ERROR_HANDLER: LoaderErrorHandler = (err, key, loader, logger) => {
  logger.error(`Error while loading "${key}" with ${loader.name}: ${err.message}`)
}

export const DEFAULT_CACHE_ERROR_HANDLER: LoaderErrorHandler = (err, key, cache, logger) => {
  logger.error(`Error while caching "${key}" with ${cache.name}: ${err.message}`)
}

const DEFAULT_CONFIG: LoadingOperationConfig = {
  logger: defaultLogger,
  throwIfUnresolved: false,
  cacheUpdateErrorHandler: DEFAULT_CACHE_ERROR_HANDLER,
  loadErrorHandler: DEFAULT_LOAD_ERROR_HANDLER,
  loadingOperationMemorySize: 100,
  loadingOperationMemoryTtl: 1000 * 30,
}

export class LoadingOperation<LoadedValue> {
  private readonly params: LoadingOperationConfig
  private readonly loaders: readonly Loader<LoadedValue>[]
  private readonly cacheIndexes: readonly number[]
  private readonly runningLoads: LRU<Promise<LoadedValue | undefined | null> | undefined>

  constructor(loaders: readonly Loader<LoadedValue>[], params: Partial<LoadingOperationConfig> = DEFAULT_CONFIG) {
    this.params = {
      ...DEFAULT_CONFIG,
      ...params,
    }
    this.loaders = loaders
    this.runningLoads = lru(params.loadingOperationMemorySize, params.loadingOperationMemoryTtl)

    this.cacheIndexes = loaders.reduce((result, value, index) => {
      if (value.isCache) {
        result.push(index)
      }
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
            return (this.loaders[cacheIndex] as unknown as Cache<LoadedValue>).clear()
          })
          .catch((err) => {
            this.params.cacheUpdateErrorHandler(err, undefined, this.loaders[cacheIndex], this.params.logger)
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
            return (this.loaders[cacheIndex] as unknown as Cache<LoadedValue>).delete(key)
          })
          .catch((err) => {
            this.params.cacheUpdateErrorHandler(err, key, this.loaders[cacheIndex], this.params.logger)
          })
      )
    })
    return Promise.all(promises)
  }

  private async resolveValue(key: string): Promise<LoadedValue | undefined | null> {
    for (let index = 0; index < this.loaders.length; index++) {
      const resolvedValue = await Promise.resolve()
        .then(() => {
          return this.loaders[index].get(key)
        })
        .catch((err) => {
          this.params.loadErrorHandler(err, key, this.loaders[index], this.params.logger)

          // if last loader, fail
          if (index === this.loaders.length - 1) {
            throw new Error(`Failed to resolve value for key "${key}": ${err.message}`, { cause: err })
          }
        })

      if (resolvedValue !== undefined) {
        // update caches
        this.cacheIndexes
          .filter((cacheIndex) => {
            return cacheIndex < index
          })
          .forEach((cacheIndex) => {
            Promise.resolve()
              .then(() => {
                return (this.loaders[cacheIndex] as unknown as Cache<LoadedValue>).set(key, resolvedValue)
              })
              .catch((err) => {
                this.params.cacheUpdateErrorHandler(err, key, this.loaders[cacheIndex], this.params.logger)
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

    const loadingPromise = new Promise<LoadedValue | undefined | null>((resolve, reject) => {
      this.resolveValue(key)
        .then((resolvedValue) => {
          if (resolvedValue === undefined && this.params.throwIfUnresolved) {
            return reject(new Error(`Failed to resolve value for key "${key}"`))
          }
          resolve(resolvedValue)
          this.runningLoads.delete(key)
        })
        .catch(reject)
    })

    this.runningLoads.set(key, loadingPromise)
    return loadingPromise
  }
}
