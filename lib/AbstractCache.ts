import type { InMemoryCacheConfiguration } from './memory/InMemoryCache'
import { InMemoryCache } from './memory/InMemoryCache'
import type { InMemoryGroupCacheConfiguration } from './memory/InMemoryGroupCache'
import { InMemoryGroupCache } from './memory/InMemoryGroupCache'
import { NoopCache } from './memory/NoopCache'
import type { AbstractNotificationConsumer } from './notifications/AbstractNotificationConsumer'
import type { GroupNotificationPublisher } from './notifications/GroupNotificationPublisher'
import type { NotificationPublisher } from './notifications/NotificationPublisher'
import type { Cache, GroupCache } from './types/DataSources'
import type { SynchronousCache, SynchronousGroupCache } from './types/SyncDataSources'
import type { Logger } from './util/Logger'
import { defaultLogger } from './util/Logger'

export type LoaderErrorHandler = (
  err: Error,
  key: string | undefined,
  loader: Record<string, any>,
  logger: Logger,
) => void

export const DEFAULT_LOAD_ERROR_HANDLER: LoaderErrorHandler = (err, key, loader, logger) => {
  logger.error(`Error while loading "${key}" with ${loader.name}: ${err.message}`)
}

export const DEFAULT_CACHE_ERROR_HANDLER: LoaderErrorHandler = (err, key, cache, logger) => {
  logger.error(`Error while caching "${key}" with ${cache.name}: ${err.message}`)
}

export type CacheKeyResolver<SourceData> = (sourceData: SourceData) => string

export type IdHolder = { id: string }

export const DEFAULT_FROM_STRING_RESOLVER: CacheKeyResolver<string> = (source) => {
  if (!(typeof source === 'string')) {
    throw new Error('Please define cacheKeyFromLoadParamsResolver in your loader config if you are using composite loadParams and not just string keys')
  }
  return source
}

export const DEFAULT_FROM_ID_RESOLVER: CacheKeyResolver<IdHolder> = (source: IdHolder) => source.id
export const DEFAULT_UNDEFINED_FROM_VALUE_RESOLVER: CacheKeyResolver<unknown> = () => { throw new Error('Please define cacheKeyFromValueResolver in your loader config if you want to use getMany operations') }

export type CommonCacheConfig<
  LoadedValue,
  CacheType extends Cache<LoadedValue> | GroupCache<LoadedValue> = Cache<LoadedValue>,
  InMemoryCacheConfigType extends
    | InMemoryCacheConfiguration
    | InMemoryGroupCacheConfiguration = InMemoryCacheConfiguration,
  InMemoryCacheType extends
    | SynchronousCache<LoadedValue>
    | SynchronousGroupCache<LoadedValue> = SynchronousCache<LoadedValue>,
  NotificationPublisherType extends
    | NotificationPublisher<LoadedValue>
    | GroupNotificationPublisher<LoadedValue> = NotificationPublisher<LoadedValue>,
  LoadParams = string
> = {
  logger?: Logger
  cacheUpdateErrorHandler?: LoaderErrorHandler
  loadErrorHandler?: LoaderErrorHandler
  inMemoryCache?: InMemoryCacheConfigType | false
  asyncCache?: CacheType
  notificationConsumer?: AbstractNotificationConsumer<LoadedValue, InMemoryCacheType>
  notificationPublisher?: NotificationPublisherType
  cacheKeyFromLoadParamsResolver?: CacheKeyResolver<LoadParams>
  cacheKeyFromValueResolver?: CacheKeyResolver<LoadedValue>
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
    | InMemoryGroupCacheConfiguration = InMemoryCacheConfiguration,
  NotificationPublisherType extends
    | NotificationPublisher<LoadedValue>
    | GroupNotificationPublisher<LoadedValue> = NotificationPublisher<LoadedValue>,
  LoadParams = string
> {
  protected readonly inMemoryCache: InMemoryCacheType
  protected readonly asyncCache?: CacheType
  public readonly cacheKeyFromLoadParamsResolver: CacheKeyResolver<LoadParams>
  public readonly cacheKeyFromValueResolver: CacheKeyResolver<LoadedValue>

  protected readonly logger: Logger
  protected readonly cacheUpdateErrorHandler: LoaderErrorHandler
  protected readonly loadErrorHandler: LoaderErrorHandler

  protected readonly runningLoads: Map<string, LoadChildType>
  private readonly notificationConsumer?: AbstractNotificationConsumer<LoadedValue, InMemoryCacheType>
  protected readonly notificationPublisher?: NotificationPublisherType

  abstract isGroupCache(): boolean

  private initPromises: Promise<unknown>[]

  constructor(
    config: CommonCacheConfig<
      LoadedValue,
      CacheType,
      InMemoryCacheConfigType,
      InMemoryCacheType,
      NotificationPublisherType,
      LoadParams
    >,
  ) {
    this.initPromises = []
    // @ts-expect-error By default we assume simple string params
    this.cacheKeyFromLoadParamsResolver = config.cacheKeyFromLoadParamsResolver ?? DEFAULT_FROM_STRING_RESOLVER
    this.cacheKeyFromValueResolver = config.cacheKeyFromValueResolver ?? DEFAULT_UNDEFINED_FROM_VALUE_RESOLVER

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
      this.initPromises.push(
        this.notificationConsumer.subscribe().catch((err) => {
          /* v8 ignore next -- @preserve */
          this.notificationConsumer!.errorHandler(err, this.notificationConsumer!.serverUuid, this.logger)
        }),
      )
    }

    if (config.notificationPublisher) {
      this.notificationPublisher = config.notificationPublisher
      this.initPromises.push(
        this.notificationPublisher.subscribe().catch((err) => {
          /* v8 ignore next -- @preserve */
          this.notificationPublisher!.errorHandler(err, this.notificationPublisher!.channel, this.logger)
        }),
      )
    }

    this.runningLoads = new Map()
  }

  public async init() {
    await Promise.all(this.initPromises)
    this.initPromises = []
  }

  public async invalidateCache() {
    this.inMemoryCache.clear()
    if (this.asyncCache) {
      await this.asyncCache.clear().catch((err) => {
        this.cacheUpdateErrorHandler(err, undefined, this.asyncCache!, this.logger)
      })
    }

    this.runningLoads.clear()

    if (this.notificationPublisher) {
      this.notificationPublisher.clear().catch((err) => {
        this.notificationPublisher!.errorHandler(err, this.notificationPublisher!.channel, this.logger)
      })
    }
  }

  public async close() {
    if (this.asyncCache) {
      await this.asyncCache.close()
    }

    /* v8 ignore next -- @preserve */
    if (this.notificationConsumer) {
      try {
        await this.notificationConsumer.close()
      } catch (err) {
        // @ts-ignore
        this.logger.error(`Failed to close notification consumer: ${err.message}`)
      }
    }
    /* v8 ignore next -- @preserve */
    if (this.notificationPublisher) {
      try {
        await this.notificationPublisher.close()
      } catch (err) {
        // @ts-ignore
        this.logger.error(`Failed to close notification publisher: ${err.message}`)
      }
    }
  }
}
