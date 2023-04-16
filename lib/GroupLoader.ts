import type { GroupCache, GroupDataSource } from './types/DataSources'
import type { LoaderConfig } from './Loader'
import { AbstractGroupCache } from './AbstractGroupCache'
import type { InMemoryGroupCacheConfiguration } from './memory/InMemoryGroupCache'

export type GroupLoaderConfig<LoadedValue, LoaderParams = undefined> = LoaderConfig<
  LoadedValue,
  GroupCache<LoadedValue>,
  LoaderParams,
  GroupDataSource<LoadedValue, LoaderParams>,
  InMemoryGroupCacheConfiguration
>
export class GroupLoader<LoadedValue, LoaderParams = undefined> extends AbstractGroupCache<LoadedValue, LoaderParams> {
  private readonly dataSources: readonly GroupDataSource<LoadedValue, LoaderParams>[]
  private readonly groupRefreshFlags: Map<string, Set<string>>
  protected readonly throwIfLoadError: boolean
  protected readonly throwIfUnresolved: boolean

  constructor(config: GroupLoaderConfig<LoadedValue, LoaderParams>) {
    super(config)
    this.loaders = config.dataSources ?? []
    this.throwIfLoadError = config.throwIfLoadError ?? true
    this.throwIfUnresolved = config.throwIfUnresolved ?? false
    this.groupRefreshFlags = new Map()
  }

  protected override resolveGroupValue(
    key: string,
    group: string,
    loadParams?: LoaderParams
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

  private async loadFromLoaders(key: string, group: string, loadParams?: LoaderParams) {
    for (let index = 0; index < this.loaders.length; index++) {
      const resolvedValue = await this.loaders[index].getFromGroup(key, group, loadParams).catch((err) => {
        this.loadErrorHandler(err, key, this.loaders[index], this.logger)
        if (this.throwIfLoadError) {
          throw err
        }
      })
      if (resolvedValue !== undefined || index === this.loaders.length - 1) {
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
}
