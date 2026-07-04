import type { CommonCacheConfig } from './AbstractCache'
import { AbstractFlatCache } from './AbstractFlatCache'
import { GeneratedDataSource } from './GeneratedDataSource'
import type { InMemoryCacheConfiguration } from './memory/InMemoryCache'
import type { InMemoryGroupCacheConfiguration } from './memory/InMemoryGroupCache'
import type { GroupNotificationPublisher } from './notifications/GroupNotificationPublisher'
import type { NotificationPublisher } from './notifications/NotificationPublisher'
import type { Cache, CacheEntry, DataSource, GroupCache, IsEntryStillCurrentFn } from './types/DataSources'
import type { GetManyResult, SynchronousCache, SynchronousGroupCache } from './types/SyncDataSources'

export type LoaderConfig<
  LoadedValue,
  LoadParams = string,
  LoadManyParams = LoadParams extends string ? undefined : LoadParams,
  CacheType extends Cache<LoadedValue> | GroupCache<LoadedValue> = Cache<LoadedValue>,
  DataSourceType = DataSource<LoadedValue, LoadParams, LoadManyParams>,
  InMemoryCacheConfigType extends
    | InMemoryCacheConfiguration
    | InMemoryGroupCacheConfiguration = InMemoryCacheConfiguration,
  InMemoryCacheType extends
    | SynchronousCache<LoadedValue>
    | SynchronousGroupCache<LoadedValue> = SynchronousCache<LoadedValue>,
  NotificationPublisherType extends
    | NotificationPublisher<LoadedValue>
    | GroupNotificationPublisher<LoadedValue> = NotificationPublisher<LoadedValue>,
  IsEntryStillCurrentFnType = IsEntryStillCurrentFn<LoadedValue, LoadParams>
> = {
  dataSources?: readonly DataSourceType[]
  dataSourceGetOneFn?: (loadParams: LoadParams) => Promise<LoadedValue | undefined | null>
  dataSourceGetManyFn?: (keys: string[], loadParams?: LoadManyParams) => Promise<LoadedValue[]>
  dataSourceName?: string
  isEntryStillCurrentFn?: IsEntryStillCurrentFnType
  throwIfLoadError?: boolean
  throwIfUnresolved?: boolean
} & CommonCacheConfig<LoadedValue, CacheType, InMemoryCacheConfigType, InMemoryCacheType, NotificationPublisherType, LoadParams>

export class Loader<LoadedValue, LoadParams = string, LoadManyParams = LoadParams extends string ? undefined : LoadParams> extends AbstractFlatCache<LoadedValue, LoadParams, LoadManyParams> {
  private readonly dataSources: readonly DataSource<LoadedValue, LoadParams, LoadManyParams>[]
  private readonly isKeyRefreshing: Set<string>
  private readonly isEntryStillCurrentFn?: IsEntryStillCurrentFn<LoadedValue, LoadParams>
  protected readonly throwIfLoadError: boolean
  protected readonly throwIfUnresolved: boolean

  constructor(config: LoaderConfig<LoadedValue, LoadParams, LoadManyParams, Cache<LoadedValue>>) {
    super(config)

    // generated datasource
    if (config.dataSourceGetManyFn || config.dataSourceGetOneFn) {
      if (config.dataSources) {
        throw new Error('Cannot set both "dataSources" and "dataSourceGetManyFn"/"dataSourceGetOneFn" parameters.')
      }

      this.dataSources = [
        new GeneratedDataSource({
          dataSourceGetOneFn: config.dataSourceGetOneFn,
          dataSourceGetManyFn: config.dataSourceGetManyFn,
          name: config.dataSourceName,
        }),
      ]
    }
    // defined datasource
    else if (config.dataSources) {
      this.dataSources = config.dataSources
    }
    // no datasource
    else {
      this.dataSources = []
    }

    this.assertStalenessCheckSupported(config.isEntryStillCurrentFn, this.asyncCache?.resetTtl, 'resetTtl')
    this.isEntryStillCurrentFn = config.isEntryStillCurrentFn

    this.throwIfLoadError = config.throwIfLoadError ?? true
    this.throwIfUnresolved = config.throwIfUnresolved ?? false
    this.isKeyRefreshing = new Set()
  }

  public async forceSetValue(key: string, newValue: LoadedValue | null) {
    this.inMemoryCache.set(key, newValue)
    this.runningLoads.delete(key)

    if (this.asyncCache) {
      await this.asyncCache.set(key, newValue).catch((err) => {
        /* v8 ignore next -- @preserve */
        this.cacheUpdateErrorHandler(err, key, this.asyncCache!, this.logger)
      })
    }

    /* v8 ignore next -- @preserve */
    if (this.notificationPublisher) {
      this.notificationPublisher.set(key, newValue).catch((err) => {
        this.notificationPublisher!.errorHandler(err, this.notificationPublisher!.channel, this.logger)
      })
    }
  }

  public forceRefresh(loadParams: LoadParams): Promise<LoadedValue | undefined | null> {
    const key = this.cacheKeyFromLoadParamsResolver(loadParams)
    return this.loadFromLoaders(key, loadParams).then((finalValue) => {
      if (finalValue !== undefined) {
        this.inMemoryCache.set(key, finalValue)
        this.runningLoads.delete(key)
      }

      // In order to keep other cluster nodes in-sync with potentially changed entry, we force them to refresh too
      /* v8 ignore next -- @preserve */
      if (this.notificationPublisher) {
        this.notificationPublisher.delete(key).catch((err) => {
          this.notificationPublisher!.errorHandler(err, this.notificationPublisher!.channel, this.logger)
        })
      }

      return finalValue
    })
  }

  protected override resolveValue(key: string, loadParams: LoadParams): Promise<LoadedValue | undefined | null> {
    return super.resolveValue(key, loadParams).then((cachedValue) => {
      // value resolved from cache
      if (cachedValue !== undefined) {
        if (this.asyncCache?.ttlLeftBeforeRefreshInMsecs) {
          if (!this.isKeyRefreshing.has(key)) {
            this.asyncCache.expirationTimeLoadingOperation
              .get(key)
              .then((expirationTime) => {
                if (expirationTime && expirationTime - Date.now() < this.asyncCache!.ttlLeftBeforeRefreshInMsecs!) {
                  // check second time, maybe someone obtained the lock while we were checking the expiration date
                  if (!this.isKeyRefreshing.has(key)) {
                    this.isKeyRefreshing.add(key)
                    this.refreshOrBumpTtl(key, loadParams, cachedValue)
                      .catch((err) => {
                        this.logger.error(err.message)
                      })
                      .finally(() => {
                        this.isKeyRefreshing.delete(key)
                      })
                  }
                }
              })
              .catch((err) => {
                // expiration lookup is fire-and-forget; a rejection here must not become
                // an unhandled promise rejection
                this.logger.error(err.message)
              })
          }
        }

        return cachedValue
      }

      // No cached value, we have to load instead
      return this.loadFromLoaders(key, loadParams)
    })
  }

  protected override scheduleInMemoryRefresh(key: string, loadParams: LoadParams): void {
    // No probe configured, or the async cache owns the probe (async wins) - use the default blind
    // background reload, exactly as before.
    if (!this.isEntryStillCurrentFn || this.asyncCache?.ttlLeftBeforeRefreshInMsecs) {
      super.scheduleInMemoryRefresh(key, loadParams)
      return
    }

    // Reuse the flat refresh guard so concurrent in-window hits schedule a single probe.
    if (this.isKeyRefreshing.has(key)) {
      return
    }
    this.isKeyRefreshing.add(key)
    this.refreshOrBumpInMemoryTtl(key, loadParams)
      .catch((err) => {
        this.logger.error(err.message)
      })
      .finally(() => {
        this.isKeyRefreshing.delete(key)
      })
  }

  private async refreshOrBumpInMemoryTtl(key: string, loadParams: LoadParams): Promise<void> {
    const cachedValue = this.inMemoryCache.get(key)
    if (
      this.isEntryStillCurrentFn &&
      // undefined means the entry vanished (expired/invalidated) between the read and the probe.
      cachedValue !== undefined &&
      (await this.isCurrentEntryTtlBumped(
        key,
        () => this.isEntryStillCurrentFn!(cachedValue, loadParams),
        () => Promise.resolve(this.inMemoryCache.resetTtl(key)),
      ))
    ) {
      // Still current - the in-memory TTL was bumped, nothing else to do.
      return
    }

    // The entry is stale, the check failed, or the bump failed (entry expired/deleted meanwhile),
    // so run the full background refresh. Route it through getAsyncOnlyResolved rather than calling
    // loadFromLoaders + inMemoryCache.set directly: that registers the reload in runningLoads, so it
    // is deduplicated against a concurrent cache-miss load and, crucially, fenced by
    // invalidateCacheFor / forceSetValue - an in-flight result whose entry was invalidated or
    // force-set meanwhile is discarded instead of resurrecting or clobbering the entry.
    await this.getAsyncOnlyResolved(key, loadParams)
  }

  private async refreshOrBumpTtl(key: string, loadParams: LoadParams, cachedValue: LoadedValue | null): Promise<void> {
    if (
      this.isEntryStillCurrentFn &&
      (await this.isCurrentEntryTtlBumped(
        key,
        () => this.isEntryStillCurrentFn!(cachedValue, loadParams),
        () => this.asyncCache!.resetTtl!(key),
      ))
    ) {
      // getAsyncOnly already re-set the in-memory entry to this same value when resolveValue
      // resolved, which reset its TTL; the value is unchanged on a bump, so nothing else to do.
      return
    }

    // The entry is stale, the check failed, or the bump failed (entry expired/deleted meanwhile),
    // so run the full background refresh from the data sources.
    const freshValue = await this.loadFromLoaders(key, loadParams)
    // Propagate the freshly loaded value to the in-memory cache as well.
    // Without this, the in-memory layer keeps serving the stale value that
    // was read from the async cache before this background refresh started,
    // and its TTL is reset on the next read, so subsequent reads stay stale
    // for another full ttlInMsecs window even though the async cache is fresh.
    if (freshValue !== undefined) {
      this.inMemoryCache.set(key, freshValue)
    }
  }

  private async loadFromLoaders(key: string, loadParams: LoadParams) {
    for (let index = 0; index < this.dataSources.length; index++) {
      const dataSource = this.dataSources[index]
      const resolvedValue = await dataSource.get(loadParams).catch((err) => {
        this.loadErrorHandler(err, key, dataSource, this.logger)
        if (this.throwIfLoadError) {
          throw err
        }
      })
      // null means "resolved to empty value" and should be cached
      // undefined means "not resolved" and should not be cached
      if (resolvedValue !== undefined) {
        if (this.asyncCache) {
          await this.asyncCache.set(key, resolvedValue).catch((err) => {
            this.cacheUpdateErrorHandler(err, key, this.asyncCache!, this.logger)
          })
        }
        return resolvedValue
      }
    }

    // All data sources returned undefined - value not resolved
    if (this.throwIfUnresolved) {
      throw new Error(`Failed to resolve value for key "${key}"`)
    }
    return undefined
  }

  protected override async resolveManyValues(
    keys: string[],
    loadParams: LoadManyParams,
  ): Promise<GetManyResult<LoadedValue>> {
    // load what is available from async cache
    const cachedValues = await super.resolveManyValues(keys, loadParams)

    // everything was cached, no need to load anything
    if (cachedValues.unresolvedKeys.length === 0) {
      return cachedValues
    }

    const loadValues = await this.loadManyFromLoaders(cachedValues.unresolvedKeys, loadParams)

    if (this.asyncCache) {
      const cacheEntries: CacheEntry<LoadedValue>[] = []
      for (let i = 0; i < loadValues.length; i++) {
        cacheEntries.push({
          key: this.cacheKeyFromValueResolver(loadValues[i]),
          value: loadValues[i],
        })
      }

      await this.asyncCache.setMany(cacheEntries).catch((err) => {
        this.cacheUpdateErrorHandler(
          err,
          cacheEntries.map((entry) => entry.key).join(', '),
          this.asyncCache!,
          this.logger,
        )
      })
    }

    return {
      // concat instead of in-place push, as cachedValues may be owned by a user-implemented async cache
      resolvedValues: cachedValues.resolvedValues.concat(loadValues),

      // there actually may still be some unresolved keys, but we no longer know that
      unresolvedKeys: [],
    }
  }

  private async loadManyFromLoaders(keys: string[], loadParams: LoadManyParams) {
    let lastResolvedValues
    for (let index = 0; index < this.dataSources.length; index++) {
      const dataSource = this.dataSources[index]
      lastResolvedValues = await dataSource.getMany(keys, loadParams).catch((err) => {
        this.loadErrorHandler(err, keys.toString(), dataSource, this.logger)
        if (this.throwIfLoadError) {
          throw err
        }
        return [] as LoadedValue[]
      })

      if (lastResolvedValues.length === keys.length) {
        return lastResolvedValues
      }
    }

    if (this.throwIfUnresolved) {
      throw new Error(`Failed to resolve value for some of the keys: ${keys.join(', ')}`)
    }

    // ToDo do we want to return results of a query that returned the most amount of entities?
    return lastResolvedValues ?? []
  }
}
