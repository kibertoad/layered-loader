import type { InMemoryCacheConfiguration } from './memory'
import { InMemoryCache, NoopCache } from './memory'
import type { SynchronousGroupCache, SynchronousCache } from './types/SyncDataSources'
import type { Cache, GroupCache } from './types/DataSources'
import type { Logger } from './util/Logger'
import { defaultLogger } from './util/Logger'
import type { InMemoryGroupCacheConfiguration } from './memory/InMemoryGroupCache'
import { InMemoryGroupCache } from './memory/InMemoryGroupCache'
import type { AbstractNotificationConsumer } from './notifications/AbstractNotificationConsumer'

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

export type CommonCacheConfig<
  LoadedValue,
  CacheType extends Cache<LoadedValue> | GroupCache<LoadedValue> = Cache<LoadedValue>,
  InMemoryCacheConfigType extends
    | InMemoryCacheConfiguration
    | InMemoryGroupCacheConfiguration = InMemoryCacheConfiguration,
  InMemoryCacheType extends
    | SynchronousCache<LoadedValue>
    | SynchronousGroupCache<LoadedValue> = SynchronousCache<LoadedValue>
> = {
  logger?: Logger
  cacheUpdateErrorHandler?: LoaderErrorHandler
  loadErrorHandler?: LoaderErrorHandler
  inMemoryCache?: InMemoryCacheConfigType | false
  asyncCache?: CacheType
  notificationConsumer?: AbstractNotificationConsumer<LoadedValue, InMemoryCacheType>
}

export abstract class AbstractCache<
  LoadedValue,
  LoadChildType = Promise<LoadedValue | undefined | null> | undefined,
  CacheType extends Cache<LoadedValue> | GroupCache<LoadedValue> = Cache<LoadedValue>,
  InMemoryCacheType extends
    | SynchronousCache<LoadedValue>
    | SynchronousGroupCache<LoadedValue> = SynchronousCache<LoadedValue>,
  InMemoryCacheConfigType extends
    | InMemoryCacheConfiguration
    | InMemoryGroupCacheConfiguration = InMemoryCacheConfiguration
> {
  protected readonly inMemoryCache: InMemoryCacheType
  protected readonly asyncCache?: CacheType

  protected readonly logger: Logger
  protected readonly cacheUpdateErrorHandler: LoaderErrorHandler
  protected readonly loadErrorHandler: LoaderErrorHandler

  protected readonly runningLoads: Map<string, LoadChildType>
  private readonly notificationConsumer?: AbstractNotificationConsumer<LoadedValue, InMemoryCacheType>

  abstract isGroupCache(): boolean

  constructor(config: CommonCacheConfig<LoadedValue, CacheType, InMemoryCacheConfigType, InMemoryCacheType>) {
    if (config.inMemoryCache) {
      if (this.isGroupCache()) {
        // @ts-ignore
        this.inMemoryCache = new InMemoryGroupCache(config.inMemoryCache)
      } else {
        // @ts-ignore
        this.inMemoryCache = new InMemoryCache(config.inMemoryCache)
      }
    } else {
      // @ts-ignore
      this.inMemoryCache = new NoopCache()
    }

    this.asyncCache = config.asyncCache
    this.logger = config.logger ?? defaultLogger
    this.cacheUpdateErrorHandler = config.cacheUpdateErrorHandler ?? DEFAULT_CACHE_ERROR_HANDLER
    this.loadErrorHandler = config.loadErrorHandler ?? DEFAULT_LOAD_ERROR_HANDLER

    if (config.notificationConsumer) {
      if (!config.inMemoryCache) {
        throw new Error('Cannot set notificationConsumer when InMemoryCache is disabled')
      }
      this.notificationConsumer = config.notificationConsumer
      this.notificationConsumer.setTargetCache(this.inMemoryCache)
      void this.notificationConsumer.subscribe()
    }

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

  public async close() {
    if (this.notificationConsumer) {
      await this.notificationConsumer.close()
    }
  }
}
