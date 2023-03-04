import { InMemoryCache, InMemoryCacheConfiguration, NoopCache } from './memory'
import { SynchronousGroupedCache } from './types/SyncDataSources'
import { Cache } from './types/DataSources'
import { defaultLogger, Logger } from './Logger'

export type LoaderErrorHandler = (
  err: Error,
  key: string | undefined,
  loader: Record<string, any>,
  logger: Logger
) => void

export const DEFAULT_LOAD_ERROR_HANDLER: LoaderErrorHandler = (err, key, loader, logger) => {
  logger.error(`Error while loading "${key}" with ${loader.name}: ${err.message}`)
}

export const DEFAULT_CACHE_ERROR_HANDLER: LoaderErrorHandler = (err, key, cache, logger) => {
  logger.error(`Error while caching "${key}" with ${cache.name}: ${err.message}`)
}

export type CommonOperationConfig<T> = {
  logger?: Logger
  throwIfUnresolved?: boolean
  throwIfLoadError?: boolean
  cacheUpdateErrorHandler?: LoaderErrorHandler
  loadErrorHandler?: LoaderErrorHandler
  inMemoryCache?: InMemoryCacheConfiguration | false
  asyncCache?: Cache<T>
}

export abstract class AbstractOperation<T> {
  protected readonly inMemoryCache: SynchronousGroupedCache<T>
  protected readonly asyncCache?: Cache<T>

  protected readonly logger: Logger
  protected readonly throwIfUnresolved: boolean
  protected readonly throwIfLoadError: boolean
  protected readonly cacheUpdateErrorHandler: LoaderErrorHandler
  protected readonly loadErrorHandler: LoaderErrorHandler

  protected readonly runningLoads: Map<string, Promise<T | undefined | null> | undefined>

  constructor(config: CommonOperationConfig<T>) {
    this.inMemoryCache = config.inMemoryCache ? new InMemoryCache(config.inMemoryCache) : new NoopCache()
    this.asyncCache = config.asyncCache
    this.logger = config.logger ?? defaultLogger
    this.cacheUpdateErrorHandler = config.cacheUpdateErrorHandler ?? DEFAULT_CACHE_ERROR_HANDLER
    this.loadErrorHandler = config.loadErrorHandler ?? DEFAULT_LOAD_ERROR_HANDLER
    this.throwIfUnresolved = config.throwIfUnresolved ?? false
    this.throwIfLoadError = config.throwIfLoadError ?? true

    this.runningLoads = new Map()
  }

  public async invalidateCache() {
    this.inMemoryCache.clear()
    if (this.asyncCache) {
      await this.asyncCache.clear().catch((err) => {
        this.cacheUpdateErrorHandler(err, undefined, this.asyncCache!, this.logger)
      })
    }

    this.runningLoads.clear()
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

  public async get(key: string): Promise<T | undefined | null> {
    const inMemoryValue = this.inMemoryCache.get(key)
    if (inMemoryValue) {
      return inMemoryValue
    }

    const existingLoad = this.runningLoads.get(key)
    if (existingLoad) {
      return existingLoad
    }

    const loadingPromise = this.resolveValue(key).then((resolvedValue) => {
      if (resolvedValue === undefined) {
        if (this.throwIfUnresolved) {
          throw new Error(`Failed to resolve value for key "${key}"`)
        }
      } else {
        this.inMemoryCache.set(key, resolvedValue)
      }
      this.runningLoads.delete(key)
      return resolvedValue
    })

    this.runningLoads.set(key, loadingPromise)
    return loadingPromise
  }

  protected async resolveValue(key: string): Promise<T | undefined | null> {
    if (this.asyncCache) {
      const cachedValue = await this.asyncCache.get(key).catch((err) => {
        this.loadErrorHandler(err, key, this.asyncCache!, this.logger)
      })
      if (cachedValue) {
        return cachedValue
      }
    }

    return undefined
  }
}
