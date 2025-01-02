import type { CommonCacheConfig } from './AbstractCache'
import { AbstractFlatCache } from './AbstractFlatCache'
import { GeneratedDataSource } from './GeneratedDataSource'
import type { InMemoryCacheConfiguration } from './memory/InMemoryCache'
import type { InMemoryGroupCacheConfiguration } from './memory/InMemoryGroupCache'
import type { GroupNotificationPublisher } from './notifications/GroupNotificationPublisher'
import type { NotificationPublisher } from './notifications/NotificationPublisher'
import type { Cache, CacheEntry, DataSource, GroupCache } from './types/DataSources'
import type { GetManyResult, SynchronousCache, SynchronousGroupCache } from './types/SyncDataSources'

export type LoaderConfig<
  LoadedValue,
  LoaderParams = string,
  CacheType extends Cache<LoadedValue> | GroupCache<LoadedValue> = Cache<LoadedValue>,
  DataSourceType = DataSource<LoadedValue, LoaderParams>,
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
  dataSources?: readonly DataSourceType[]
  dataSourceGetOneFn?: (key: string, loadParams?: LoaderParams) => Promise<LoadedValue | undefined | null>
  dataSourceGetManyFn?: (keys: string[], loadParams?: LoaderParams) => Promise<LoadedValue[]>
  dataSourceName?: string
  throwIfLoadError?: boolean
  throwIfUnresolved?: boolean
} & CommonCacheConfig<LoadedValue, CacheType, InMemoryCacheConfigType, InMemoryCacheType, NotificationPublisherType, LoadParams>

export class Loader<LoadedValue, LoadParams = string> extends AbstractFlatCache<LoadedValue, LoadParams> {
  private readonly dataSources: readonly DataSource<LoadedValue, LoadParams>[]
  private readonly isKeyRefreshing: Set<string>
  protected readonly throwIfLoadError: boolean
  protected readonly throwIfUnresolved: boolean

  constructor(config: LoaderConfig<LoadedValue, LoadParams, Cache<LoadedValue>,
      DataSource<LoadedValue, LoadParams>,
      InMemoryCacheConfiguration,
      SynchronousCache<LoadedValue>,
      NotificationPublisher<LoadedValue>,
      LoadParams
  >) {
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

    this.throwIfLoadError = config.throwIfLoadError ?? true
    this.throwIfUnresolved = config.throwIfUnresolved ?? false
    this.isKeyRefreshing = new Set()
  }

  public async forceSetValue(key: string, newValue: LoadedValue | null) {
    this.inMemoryCache.set(key, newValue)
    /* v8 ignore next 3 */
    if (this.runningLoads.has(key)) {
      this.runningLoads.delete(key)
    }

    if (this.asyncCache) {
      await this.asyncCache.set(key, newValue).catch((err) => {
        /* v8 ignore next 1 */
        this.cacheUpdateErrorHandler(err, key, this.asyncCache!, this.logger)
      })
    }

    /* v8 ignore next 5 */
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

        /* v8 ignore next 3 */
        if (this.runningLoads.has(key)) {
          this.runningLoads.delete(key)
        }
      }

      // In order to keep other cluster nodes in-sync with potentially changed entry, we force them to refresh too
      /* v8 ignore next 5 */
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
            this.asyncCache.expirationTimeLoadingOperation.get(key).then((expirationTime) => {
              if (expirationTime && expirationTime - Date.now() < this.asyncCache!.ttlLeftBeforeRefreshInMsecs!) {
                // check second time, maybe someone obtained the lock while we were checking the expiration date
                if (!this.isKeyRefreshing.has(key)) {
                  this.isKeyRefreshing.add(key)
                  this.loadFromLoaders(key, loadParams)
                    .catch((err) => {
                      this.logger.error(err.message)
                    })
                    .finally(() => {
                      this.isKeyRefreshing.delete(key)
                    })
                }
              }
            })
          }
        }

        return cachedValue
      }

      // No cached value, we have to load instead
      return this.loadFromLoaders(key, loadParams).then((finalValue) => {
        if (finalValue !== undefined) {
          return finalValue
        }

        if (this.throwIfUnresolved) {
          throw new Error(`Failed to resolve value for key "${key}"`)
        }
        return undefined
      })
    })
  }

  private async loadFromLoaders(key: string, loadParams: LoadParams) {
    for (let index = 0; index < this.dataSources.length; index++) {
      const resolvedValue = await this.dataSources[index].get(key, loadParams).catch((err) => {
        this.loadErrorHandler(err, key, this.dataSources[index], this.logger)
        if (this.throwIfLoadError) {
          throw err
        }
      })
      if (resolvedValue !== undefined || index === this.dataSources.length - 1) {
        if (resolvedValue === undefined && this.throwIfUnresolved) {
          throw new Error(`Failed to resolve value for key "${key}"`)
        }

        const finalValue = resolvedValue ?? null
        if (this.asyncCache) {
          await this.asyncCache.set(key, finalValue).catch((err) => {
            this.cacheUpdateErrorHandler(err, key, this.asyncCache!, this.logger)
          })
        }
        return finalValue
      }
    }

    return undefined
  }

  protected override async resolveManyValues(
    keys: string[],
    loadParams: LoadParams,
  ): Promise<GetManyResult<LoadedValue>> {
    // load what is available from async cache
    const cachedValues = await super.resolveManyValues(keys, loadParams)

    // everything was cached, no need to load anything
    if (cachedValues.unresolvedKeys.length === 0) {
      return cachedValues
    }

    const loadValues = await this.loadManyFromLoaders(cachedValues.unresolvedKeys, loadParams)

    if (this.asyncCache) {
      const cacheEntries: CacheEntry<LoadedValue>[] = loadValues.map((loadValue) => {
        return {
          key: this.cacheKeyFromValueResolver(loadValue),
          value: loadValue,
        }
      })

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
      resolvedValues: [...cachedValues.resolvedValues, ...loadValues],

      // there actually may still be some unresolved keys, but we no longer know that
      unresolvedKeys: [],
    }
  }

  private async loadManyFromLoaders(keys: string[], loadParams: LoadParams) {
    let lastResolvedValues
    for (let index = 0; index < this.dataSources.length; index++) {
      lastResolvedValues = await this.dataSources[index].getMany(keys, loadParams).catch((err) => {
        this.loadErrorHandler(err, keys.toString(), this.dataSources[index], this.logger)
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
