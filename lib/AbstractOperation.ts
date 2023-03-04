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

export type CommonOperationConfig<T, C extends Cache<T> = Cache<T>> = {
  logger?: Logger
  throwIfUnresolved?: boolean
  cacheUpdateErrorHandler?: LoaderErrorHandler
  loadErrorHandler?: LoaderErrorHandler
  inMemoryCache?: InMemoryCacheConfiguration | false
  asyncCache?: C
}

export abstract class AbstractOperation<
  T,
  LoadChildType = Promise<T | undefined | null> | undefined,
  C extends Cache<T> = Cache<T>
> {
  protected readonly inMemoryCache: SynchronousGroupedCache<T>
  protected readonly asyncCache?: C

  protected readonly logger: Logger
  protected readonly throwIfUnresolved: boolean
  protected readonly cacheUpdateErrorHandler: LoaderErrorHandler
  protected readonly loadErrorHandler: LoaderErrorHandler

  protected readonly runningLoads: Map<string, LoadChildType>

  constructor(config: CommonOperationConfig<T, C>) {
    this.inMemoryCache = config.inMemoryCache ? new InMemoryCache(config.inMemoryCache) : new NoopCache()
    this.asyncCache = config.asyncCache
    this.logger = config.logger ?? defaultLogger
    this.cacheUpdateErrorHandler = config.cacheUpdateErrorHandler ?? DEFAULT_CACHE_ERROR_HANDLER
    this.loadErrorHandler = config.loadErrorHandler ?? DEFAULT_LOAD_ERROR_HANDLER
    this.throwIfUnresolved = config.throwIfUnresolved ?? false

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
}
