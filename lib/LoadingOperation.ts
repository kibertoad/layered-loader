import { Loader, Cache } from './DataSources'
import { defaultLogger, Logger } from './Logger'

export type LoadingOperationConfig = {
  logger: Logger
  throwIfUnresolved: boolean
  cacheUpdateErrorHandler: LoaderErrorHandler
  loadErrorHandler: LoaderErrorHandler
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
}

export class LoadingOperation<LoadedValue> {
  private readonly params: LoadingOperationConfig
  private readonly loaders: readonly (Loader<LoadedValue> | Cache<LoadedValue>)[]
  private readonly cacheIndexes: readonly number[]
  private readonly runningLoads: Map<string, Promise<LoadedValue | undefined | null> | undefined>

  constructor(loaders: readonly Loader<LoadedValue>[], params: Partial<LoadingOperationConfig> = DEFAULT_CONFIG) {
    this.params = {
      ...DEFAULT_CONFIG,
      ...params,
    }
    // @ts-ignore
    this.loaders = loaders
    this.runningLoads = new Map()

    this.cacheIndexes = loaders.reduce((result, value, index) => {
      if (value.isCache) {
        result.push(index)
      }
      return result
    }, [] as number[])
  }

  public async invalidateCache() {
    const promises: Promise<any>[] = []
    this.cacheIndexes.forEach((cacheIndex) => {
      promises.push(
        // @ts-ignore
        this.loaders[cacheIndex].clear?.().catch((err) => {
          this.params.cacheUpdateErrorHandler(err, undefined, this.loaders[cacheIndex], this.params.logger)
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
        // @ts-ignore
        this.loaders[cacheIndex].delete?.(key).catch((err) => {
          this.params.cacheUpdateErrorHandler(err, key, this.loaders[cacheIndex], this.params.logger)
        })
      )
    })
    await Promise.all(promises)
    this.runningLoads.delete(key)
  }

  private async resolveValue(key: string): Promise<LoadedValue | undefined | null> {
    for (let index = 0; index < this.loaders.length; index++) {
      const resolvedValue = await this.loaders[index].get(key).catch((err) => {
        this.params.loadErrorHandler(err, key, this.loaders[index], this.params.logger)

        // if last loader, fail
        if (index === this.loaders.length - 1) {
          throw new Error(`Failed to resolve value for key "${key}": ${err.message}`, { cause: err })
        }
      })

      if (resolvedValue !== undefined) {
        const updatePromises = []
        // update caches
        for (var cacheIndex = 0; cacheIndex < index; cacheIndex++) {
          updatePromises.push(
            // @ts-ignore
            this.loaders[cacheIndex].set?.(key, resolvedValue).catch((err) => {
              this.params.cacheUpdateErrorHandler(err, key, this.loaders[cacheIndex], this.params.logger)
            })
          )
        }
        await Promise.all(updatePromises)

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

    const loadingPromise = this.resolveValue(key).then((resolvedValue) => {
      if (resolvedValue === undefined && this.params.throwIfUnresolved) {
        throw new Error(`Failed to resolve value for key "${key}"`)
      }
      this.runningLoads.delete(key)
      return resolvedValue
    })

    this.runningLoads.set(key, loadingPromise)
    return loadingPromise
  }
}
