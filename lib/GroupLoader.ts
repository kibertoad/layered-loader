import { AbstractGroupCache } from './AbstractGroupCache.js'
import type { LoaderConfig } from './Loader.js'
import type { InMemoryGroupCache, InMemoryGroupCacheConfiguration } from './memory/InMemoryGroupCache.js'
import type { GroupNotificationPublisher } from './notifications/GroupNotificationPublisher.js'
import type { CacheEntry, GroupCache, GroupDataSource, IsGroupEntryStillCurrentFn } from './types/DataSources.js'
import type { GetManyResult } from './types/SyncDataSources.js'

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
            this.asyncCache.expirationTimeLoadingGroupedOperation
              .get(key, group)
              .then((expirationTime) => {
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
              .catch((err) => {
                // expiration lookup is fire-and-forget; a rejection here must not become
                // an unhandled promise rejection
                this.logger.error(err.message)
              })
          }
        }
        return cachedValue
      }

      return this.loadFromLoaders(key, group, loadParams)
    })
  }

  protected override scheduleInMemoryRefresh(key: string, loadParams: LoadParams, group: string): void {
    // No probe configured, or the async cache owns the probe (async wins) - use the default blind
    // background reload, exactly as before.
    if (!this.isEntryStillCurrentFn || this.asyncCache?.ttlLeftBeforeRefreshInMsecs) {
      super.scheduleInMemoryRefresh(key, loadParams, group)
      return
    }

    // Reuse the per-(group, key) refresh guard so concurrent in-window hits schedule a single probe.
    let groupSet = this.groupRefreshFlags.get(group)
    if (groupSet?.has(key)) {
      return
    }
    if (!groupSet) {
      groupSet = new Set<string>()
      this.groupRefreshFlags.set(group, groupSet)
    }
    groupSet.add(key)

    this.refreshOrBumpInMemoryTtl(key, group, loadParams)
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

  private async refreshOrBumpInMemoryTtl(key: string, group: string, loadParams: LoadParams): Promise<void> {
    const cachedValue = this.inMemoryCache.getFromGroup(key, group)
    if (
      this.isEntryStillCurrentFn &&
      // undefined means the entry vanished (expired/invalidated) between the read and the probe.
      cachedValue !== undefined &&
      (await this.isCurrentEntryTtlBumped(
        key,
        () => this.isEntryStillCurrentFn!(cachedValue, loadParams, group),
        () => Promise.resolve(this.inMemoryCache.resetTtlFromGroup(key, group)),
      ))
    ) {
      // Still current - the in-memory TTL was bumped, nothing else to do.
      return
    }

    // The entry is stale, the check failed, or the bump failed (entry expired or the group was
    // invalidated meanwhile), so run the full background refresh. Route it through
    // getAsyncOnlyResolved rather than calling loadFromLoaders + inMemoryCache.setForGroup directly:
    // that registers the reload in the group's runningLoads, so it is deduplicated against a
    // concurrent cache-miss load and, crucially, fenced by invalidateCacheFor / forceSetValueForGroup
    // - an in-flight result whose entry was invalidated or force-set meanwhile is discarded instead
    // of resurrecting or clobbering the entry.
    await this.getAsyncOnlyResolved(key, loadParams, group)
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
        /* v8 ignore next -- @preserve */
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
      const cacheEntries: CacheEntry<LoadedValue>[] = []
      for (let i = 0; i < loadValues.length; i++) {
        cacheEntries.push({
          key: this.cacheKeyFromValueResolver(loadValues[i]),
          value: loadValues[i],
        })
      }

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
      // concat instead of in-place push, as cachedValues may be owned by a user-implemented async cache
      resolvedValues: cachedValues.resolvedValues.concat(loadValues),

      // there actually may still be some unresolved keys, but we no longer know that
      unresolvedKeys: [],
    }
  }

  private async loadFromLoaders(key: string, group: string, loadParams: LoadParams) {
    for (let index = 0; index < this.dataSources.length; index++) {
      const dataSource = this.dataSources[index]
      const resolvedValue = await dataSource.getFromGroup(loadParams, group).catch((err) => {
        this.loadErrorHandler(err, key, dataSource, this.logger)
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
      const dataSource = this.dataSources[index]
      lastResolvedValues = await dataSource.getManyFromGroup(keys, group, loadParams).catch((err) => {
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
      throw new Error(`Failed to resolve value for some of the keys (group ${group}): ${keys.join(', ')}`)
    }

    // ToDo do we want to return results of a query that returned the most amount of entities?
    return lastResolvedValues ?? []
  }
}
