import type { CommonCacheConfig } from './AbstractCache'
import type { Cache, DataSource, GroupCache, IdResolver } from './types/DataSources'
import { AbstractFlatCache } from './AbstractFlatCache'
import type { InMemoryCacheConfiguration } from './memory'
import type { InMemoryGroupCacheConfiguration } from './memory/InMemoryGroupCache'
import type { SynchronousCache, SynchronousGroupCache, GetManyResult } from './types/SyncDataSources'
import type { NotificationPublisher } from './notifications/NotificationPublisher'
import type { GroupNotificationPublisher } from './notifications/GroupNotificationPublisher'

export type LoaderConfig<
  LoadedValue,
  CacheType extends Cache<LoadedValue> | GroupCache<LoadedValue> = Cache<LoadedValue>,
  LoaderParams = undefined,
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
> = {
  dataSources?: readonly DataSourceType[]
  throwIfLoadError?: boolean
  throwIfUnresolved?: boolean
} & CommonCacheConfig<LoadedValue, CacheType, InMemoryCacheConfigType, InMemoryCacheType, NotificationPublisherType>

export class Loader<LoadedValue, LoaderParams = undefined> extends AbstractFlatCache<LoadedValue, LoaderParams> {
  private readonly dataSources: readonly DataSource<LoadedValue, LoaderParams>[]
  private readonly isKeyRefreshing: Set<string>
  protected readonly throwIfLoadError: boolean
  protected readonly throwIfUnresolved: boolean

  constructor(config: LoaderConfig<LoadedValue, Cache<LoadedValue>, LoaderParams>) {
    super(config)
    this.dataSources = config.dataSources ?? []
    this.throwIfLoadError = config.throwIfLoadError ?? true
    this.throwIfUnresolved = config.throwIfUnresolved ?? false
    this.isKeyRefreshing = new Set()
  }

  protected override resolveValue(key: string, loadParams?: LoaderParams): Promise<LoadedValue | undefined | null> {
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

  private async loadFromLoaders(key: string, loadParams?: LoaderParams) {
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

  protected async resolveManyValues(
    keys: string[],
    idResolver: IdResolver<LoadedValue>,
    loadParams?: LoaderParams,
  ): Promise<GetManyResult<LoadedValue>> {
    // load what is available from async cache
    const cachedValues = await super.resolveManyValues(keys, idResolver, loadParams)

    // everything was cached, no need to load anything
    if (cachedValues.unresolvedKeys.length === 0) {
      return cachedValues
    }

    const loadValues = await this.loadManyFromLoaders(cachedValues.unresolvedKeys, loadParams)

    if (this.asyncCache) {
      for (let i = 0; i < loadValues.length; i++) {
        const resolvedValue = loadValues[i]
        const id = idResolver(resolvedValue)
        await this.asyncCache.set(id, resolvedValue).catch((err) => {
          this.cacheUpdateErrorHandler(err, id, this.asyncCache!, this.logger)
        })
      }
    }

    return {
      resolvedValues: [...cachedValues.resolvedValues, ...loadValues],

      // there actually may still be some unresolved keys, but we no longer know that
      unresolvedKeys: [],
    }
  }

  private async loadManyFromLoaders(keys: string[], loadParams?: LoaderParams) {
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
