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

  /**
   * Validates that an isEntryStillCurrentFn can actually run: it needs a preemptive refresh window
   * to fire inside. That window can be provided by the async cache (in which case the entry is bumped
   * via its resetTtl/resetTtlFromGroup method) or, for in-memory-only loaders, by the in-memory
   * cache. Throws otherwise, so misconfiguration fails fast instead of silently turning the feature
   * into a no-op.
   */
  protected assertStalenessCheckSupported(
    isEntryStillCurrentFn: unknown,
    resetTtlMethod: unknown,
    resetTtlMethodName: 'resetTtl' | 'resetTtlFromGroup',
  ): void {
    if (!isEntryStillCurrentFn) {
      return
    }
    // The async path takes precedence: when the async cache has a refresh window, the check runs
    // there and needs the async cache's TTL-reset method.
    if (this.asyncCache?.ttlLeftBeforeRefreshInMsecs) {
      if (typeof resetTtlMethod !== 'function') {
        throw new Error(
          `The configured asyncCache does not support ${resetTtlMethodName}, which is required by isEntryStillCurrentFn.`,
        )
      }
      return
    }
    // Otherwise the check runs on the in-memory preemptive refresh path, which needs an in-memory
    // refresh window (the in-memory cache always exposes resetTtl/resetTtlFromGroup).
    if (this.inMemoryCache.ttlLeftBeforeRefreshInMsecs) {
      return
    }
    throw new Error(
      'isEntryStillCurrentFn requires a preemptive refresh window: either an asyncCache with ttlLeftBeforeRefreshInMsecs and resetTtl/resetTtlFromGroup, or an inMemoryCache with ttlLeftBeforeRefreshInMsecs.',
    )
  }

  /**
   * Runs the staleness check for an entry entering its refresh window and, when the check reports
   * the entry as still current, extends the entry's TTL (via the caller-supplied runResetTtl, which
   * targets whichever tier owns the refresh window - the async cache or the in-memory cache) instead
   * of refetching. Returns true only when the entry was confirmed current AND its TTL was
   * successfully bumped, so the caller can safely skip the full background refresh. A check that
   * throws is routed to loadErrorHandler and treated as stale; a bump that rejects is routed to
   * cacheUpdateErrorHandler and also treated as stale, so the worst case degrades to a normal full
   * refresh.
   */
  protected async isCurrentEntryTtlBumped(
    key: string,
    runStalenessCheck: () => Promise<boolean>,
    runResetTtl: () => Promise<boolean>,
  ): Promise<boolean> {
    let isCurrent = false
    try {
      isCurrent = await runStalenessCheck()
    } catch (err) {
      // a failing check cannot confirm freshness, so fall through to a full refresh
      this.loadErrorHandler(err as Error, key, { name: 'isEntryStillCurrentFn' }, this.logger)
    }

    if (!isCurrent) {
      return false
    }

    return runResetTtl().catch((err) => {
      // The reset runs on whichever tier owns the refresh window: the async cache when it has one,
      // otherwise the in-memory cache. Report against the tier that actually failed so the handler
      // never dereferences an undefined asyncCache on the in-memory-only path.
      this.cacheUpdateErrorHandler(err, key, this.asyncCache ?? this.inMemoryCache, this.logger)
      return false
    })
  }

  public async invalidateCache() {
    // Evict the running loads first so in-flight results are fenced out of the caches.
    this.runningLoads.clear()
    if (this.asyncCache) {
      await this.asyncCache.clear().catch((err) => {
        this.cacheUpdateErrorHandler(err, undefined, this.asyncCache!, this.logger)
      })
    }

    // Evict again: a load that started while the async clear was in flight may have
    // read a not-yet-deleted async value; fencing it out here stops it from
    // repopulating the caches after this invalidation resolves. The in-memory clear
    // comes last for the same reason.
    this.runningLoads.clear()
    this.inMemoryCache.clear()

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
