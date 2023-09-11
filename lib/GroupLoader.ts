import type { GroupCache, GroupDataSource, IdResolver, CacheEntry } from './types/DataSources'
import type { LoaderConfig } from './Loader'
import { AbstractGroupCache } from './AbstractGroupCache'
import type { InMemoryGroupCacheConfiguration, InMemoryGroupCache } from './memory/InMemoryGroupCache'
import type { GroupNotificationPublisher } from './notifications/GroupNotificationPublisher'
import type { GetManyResult } from './types/SyncDataSources'

export type GroupLoaderConfig<LoadedValue, LoaderParams = undefined> = LoaderConfig<
  LoadedValue,
  GroupCache<LoadedValue>,
  LoaderParams,
  GroupDataSource<LoadedValue, LoaderParams>,
  InMemoryGroupCacheConfiguration,
  InMemoryGroupCache<LoadedValue>,
  GroupNotificationPublisher<LoadedValue>
>
export class GroupLoader<LoadedValue, LoaderParams = undefined> extends AbstractGroupCache<LoadedValue, LoaderParams> {
  private readonly dataSources: readonly GroupDataSource<LoadedValue, LoaderParams>[]
  private readonly groupRefreshFlags: Map<string, Set<string>>
  protected readonly throwIfLoadError: boolean
  protected readonly throwIfUnresolved: boolean

  constructor(config: GroupLoaderConfig<LoadedValue, LoaderParams>) {
    super(config)
    this.dataSources = config.dataSources ?? []
    this.throwIfLoadError = config.throwIfLoadError ?? true
    this.throwIfUnresolved = config.throwIfUnresolved ?? false
    this.groupRefreshFlags = new Map()
  }

  protected override resolveGroupValue(
    key: string,
    group: string,
    loadParams?: LoaderParams,
  ): Promise<LoadedValue | undefined | null> {
    return super.resolveGroupValue(key, group).then((cachedValue) => {
      if (cachedValue !== undefined) {
        if (this.asyncCache?.ttlLeftBeforeRefreshInMsecs) {
          let groupSet = this.groupRefreshFlags.get(group)
          let isAlreadyRefreshing = groupSet?.has(key)

          if (!isAlreadyRefreshing) {
            this.asyncCache.expirationTimeLoadingGroupedOperation.get(key, group).then((expirationTime) => {
              if (expirationTime && expirationTime - Date.now() < this.asyncCache!.ttlLeftBeforeRefreshInMsecs!) {
                // Check if someone else didn't start refreshing while we were checking expiration time
                groupSet = this.groupRefreshFlags.get(group)
                isAlreadyRefreshing = groupSet?.has(key)
                if (!isAlreadyRefreshing) {
                  if (!groupSet) {
                    groupSet = new Set<string>()
                    this.groupRefreshFlags.set(group, groupSet)
                  }
                  groupSet.add(key)

                  this.loadFromLoaders(key, group, loadParams)
                    .catch((err) => {
                      this.logger.error(err.message)
                    })
                    .finally(() => {
                      groupSet!.delete(key)
                    })
                }
              }
            })
          }
        }
        return cachedValue
      }

      return this.loadFromLoaders(key, group, loadParams).then((finalValue) => {
        if (finalValue !== undefined) {
          return finalValue
        }

        if (this.throwIfUnresolved) {
          throw new Error(`Failed to resolve value for key "${key}", group "${group}"`)
        }
        return undefined
      })
    })
  }

  protected override async resolveManyGroupValues(
    keys: string[],
    group: string,
    idResolver: IdResolver<LoadedValue>,
    loadParams?: LoaderParams,
  ): Promise<GetManyResult<LoadedValue>> {
    // load what is available from async cache
    const cachedValues = await super.resolveManyGroupValues(keys, group, idResolver, loadParams)

    // everything was cached, no need to load anything
    if (cachedValues.unresolvedKeys.length === 0) {
      return cachedValues
    }

    const loadValues = await this.loadManyFromLoaders(cachedValues.unresolvedKeys, group, loadParams)

    if (this.asyncCache) {
      const cacheEntries: CacheEntry<LoadedValue>[] = loadValues.map((loadValue) => {
        return {
          key: idResolver(loadValue),
          value: loadValue,
        }
      })

      await this.asyncCache.setManyForGroup(cacheEntries, group).catch((err) => {
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

  private async loadFromLoaders(key: string, group: string, loadParams?: LoaderParams) {
    for (let index = 0; index < this.dataSources.length; index++) {
      const resolvedValue = await this.dataSources[index].getFromGroup(key, group, loadParams).catch((err) => {
        this.loadErrorHandler(err, key, this.dataSources[index], this.logger)
        if (this.throwIfLoadError) {
          throw err
        }
      })
      if (resolvedValue !== undefined || index === this.dataSources.length - 1) {
        if (resolvedValue === undefined && this.throwIfUnresolved) {
          throw new Error(`Failed to resolve value for key "${key}", group "${group}"`)
        }

        const finalValue = resolvedValue ?? null
        if (this.asyncCache) {
          await this.asyncCache.setForGroup(key, finalValue, group).catch((err) => {
            this.cacheUpdateErrorHandler(err, key, this.asyncCache!, this.logger)
          })
        }
        return finalValue
      }
    }

    return undefined
  }

  private async loadManyFromLoaders(keys: string[], group: string, loadParams?: LoaderParams) {
    let lastResolvedValues
    for (let index = 0; index < this.dataSources.length; index++) {
      lastResolvedValues = await this.dataSources[index].getManyFromGroup(keys, group, loadParams).catch((err) => {
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
      throw new Error(`Failed to resolve value for some of the keys (group ${group}): ${keys.join(', ')}`)
    }

    // ToDo do we want to return results of a query that returned the most amount of entities?
    return lastResolvedValues ?? []
  }
}
