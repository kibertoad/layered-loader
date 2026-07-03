import { AbstractGroupCache } from './AbstractGroupCache'
import type { LoaderConfig } from './Loader'
import type { InMemoryGroupCache, InMemoryGroupCacheConfiguration } from './memory/InMemoryGroupCache'
import type { GroupNotificationPublisher } from './notifications/GroupNotificationPublisher'
import type { CacheEntry, GroupCache, GroupDataSource, IsGroupEntryStillCurrentFn } from './types/DataSources'
import type { GetManyResult } from './types/SyncDataSources'

export type GroupLoaderConfig<LoadedValue, LoadParams = string, LoadManyParams = LoadParams> = LoaderConfig<
  LoadedValue,
  LoadParams,
  LoadManyParams,
  GroupCache<LoadedValue>,
  GroupDataSource<LoadedValue, LoadParams, LoadManyParams>,
  InMemoryGroupCacheConfiguration,
  InMemoryGroupCache<LoadedValue>,
  GroupNotificationPublisher<LoadedValue>,
  IsGroupEntryStillCurrentFn<LoadedValue, LoadParams>
>
export class GroupLoader<LoadedValue, LoadParams = string, LoadManyParams = LoadParams extends string ? undefined : LoadParams> extends AbstractGroupCache<LoadedValue, LoadParams, LoadManyParams> {
  private readonly dataSources: readonly GroupDataSource<LoadedValue, LoadParams, LoadManyParams>[]
  private readonly groupRefreshFlags: Map<string, Set<string>>
  private readonly isEntryStillCurrentFn?: IsGroupEntryStillCurrentFn<LoadedValue, LoadParams>
  protected readonly throwIfLoadError: boolean
  protected readonly throwIfUnresolved: boolean

  constructor(config: GroupLoaderConfig<LoadedValue, LoadParams, LoadManyParams>) {
    super(config)
    this.dataSources = config.dataSources ?? []

    this.assertStalenessCheckSupported(
      config.isEntryStillCurrentFn,
      this.asyncCache?.resetTtlFromGroup,
      'resetTtlFromGroup',
    )
    this.isEntryStillCurrentFn = config.isEntryStillCurrentFn

    this.throwIfLoadError = config.throwIfLoadError ?? true
    this.throwIfUnresolved = config.throwIfUnresolved ?? false
    this.groupRefreshFlags = new Map()
  }

  protected override resolveGroupValue(
    key: string,
    group: string,
    loadParams: LoadParams,
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

                  this.refreshOrBumpTtl(key, group, loadParams, cachedValue)
                    .catch((err) => {
                      this.logger.error(err.message)
                    })
                    .finally(() => {
                      groupSet!.delete(key)
                      if (groupSet!.size === 0) {
                        this.groupRefreshFlags.delete(group)
                      }
                    })
                }
              }
            })
          }
        }
        return cachedValue
      }

      return this.loadFromLoaders(key, group, loadParams)
    })
  }

  private async refreshOrBumpTtl(
    key: string,
    group: string,
    loadParams: LoadParams,
    cachedValue: LoadedValue | null,
  ): Promise<void> {
    if (
      this.isEntryStillCurrentFn &&
      (await this.isCurrentEntryTtlBumped(
        key,
        () => this.isEntryStillCurrentFn!(cachedValue, loadParams, group),
        () => this.asyncCache!.resetTtlFromGroup!(key, group),
      ))
    ) {
      // getAsyncOnly already re-set the in-memory entry to this same value when resolveGroupValue
      // resolved, which reset its TTL; the value is unchanged on a bump, so nothing else to do.
      return
    }

    // The entry is stale, the check failed, or the bump failed (entry expired or the group was
    // invalidated meanwhile), so run the full background refresh from the data sources.
    const freshValue = await this.loadFromLoaders(key, group, loadParams)
    // Propagate the freshly loaded value to the in-memory group cache as well.
    // Without this, the in-memory layer keeps serving the stale value that
    // was read from the async cache before this background refresh started,
    // and its TTL is reset on the next read, so subsequent reads stay stale
    // for another full ttlInMsecs window even though the async cache is fresh.
    if (freshValue !== undefined) {
      this.inMemoryCache.setForGroup(key, freshValue, group)
    }
  }

  public async forceSetValueForGroup(key: string, newValue: LoadedValue | null, group: string) {
    this.inMemoryCache.setForGroup(key, newValue, group)
    this.deleteGroupRunningLoad(this.resolveGroupLoads(group), group, key)

    if (this.asyncCache) {
      await this.asyncCache.setForGroup(key, newValue, group).catch((err) => {
        this.cacheUpdateErrorHandler(err, key, this.asyncCache!, this.logger)
      })
    }
    // GroupNotificationPublisher only broadcasts deletions, so there is no set notification to
    // publish here; other nodes converge via their own TTL expiry, same as setForGroup.
  }

  protected override async resolveManyGroupValues(
    keys: string[],
    group: string,
    loadParams?: LoadManyParams,
  ): Promise<GetManyResult<LoadedValue>> {
    // load what is available from async cache
    const cachedValues = await super.resolveManyGroupValues(keys, group, loadParams)

    // everything was cached, no need to load anything
    if (cachedValues.unresolvedKeys.length === 0) {
      return cachedValues
    }

    const loadValues = await this.loadManyFromLoaders(cachedValues.unresolvedKeys, group, loadParams)

    if (this.asyncCache) {
      const cacheEntries: CacheEntry<LoadedValue>[] = loadValues.map((loadValue) => {
        return {
          key: this.cacheKeyFromValueResolver(loadValue),
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

  private async loadFromLoaders(key: string, group: string, loadParams: LoadParams) {
    for (let index = 0; index < this.dataSources.length; index++) {
      const resolvedValue = await this.dataSources[index].getFromGroup(loadParams, group).catch((err) => {
        this.loadErrorHandler(err, key, this.dataSources[index], this.logger)
        if (this.throwIfLoadError) {
          throw err
        }
      })
      // null means "resolved to empty value" and should be cached
      // undefined means "not resolved" and should not be cached
      if (resolvedValue !== undefined) {
        if (this.asyncCache) {
          await this.asyncCache.setForGroup(key, resolvedValue, group).catch((err) => {
            this.cacheUpdateErrorHandler(err, key, this.asyncCache!, this.logger)
          })
        }
        return resolvedValue
      }
    }

    // All data sources returned undefined - value not resolved
    if (this.throwIfUnresolved) {
      throw new Error(`Failed to resolve value for key "${key}", group "${group}"`)
    }
    return undefined
  }

  private async loadManyFromLoaders(keys: string[], group: string, loadParams?: LoadManyParams) {
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
