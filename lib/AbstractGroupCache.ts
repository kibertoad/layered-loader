import { AbstractCache } from './AbstractCache'
import type { GroupCache, IdResolver } from './types/DataSources'
import type { GetManyResult, SynchronousGroupCache } from './types/SyncDataSources'
import type { InMemoryGroupCacheConfiguration } from './memory/InMemoryGroupCache'
import type { GroupNotificationPublisher } from './notifications/GroupNotificationPublisher'

export abstract class AbstractGroupCache<LoadedValue, ResolveParams = undefined> extends AbstractCache<
  LoadedValue,
  Map<string, Promise<LoadedValue | undefined | null> | undefined>,
  GroupCache<LoadedValue>,
  SynchronousGroupCache<LoadedValue>,
  InMemoryGroupCacheConfiguration,
  GroupNotificationPublisher<LoadedValue>
> {
  override isGroupCache() {
    return true
  }

  public async invalidateCacheForGroup(group: string) {
    if (this.asyncCache) {
      await this.asyncCache.deleteGroup(group).catch((err) => {
        this.cacheUpdateErrorHandler(err, `group: ${group}`, this.asyncCache!, this.logger)
      })
    }

    this.inMemoryCache.deleteGroup(group)
    this.runningLoads.delete(group)

    if (this.notificationPublisher) {
      void this.notificationPublisher.deleteGroup(group).catch((err) => {
        this.notificationPublisher!.errorHandler(err, this.notificationPublisher!.channel, this.logger)
      })
    }
  }

  public getInMemoryOnly(key: string, group: string, resolveParams?: ResolveParams): LoadedValue | undefined | null {
    if (this.inMemoryCache.ttlLeftBeforeRefreshInMsecs) {
      const groupLoads = this.resolveGroupLoads(group)
      if (!groupLoads.has(key)) {
        const expirationTime = this.inMemoryCache.getExpirationTimeFromGroup(key, group)
        if (expirationTime && expirationTime - Date.now() < this.inMemoryCache.ttlLeftBeforeRefreshInMsecs) {
          void this.getAsyncOnly(key, group, resolveParams)
        }
      }
    }

    return this.inMemoryCache.getFromGroup(key, group)
  }

  public getManyInMemoryOnly(keys: string[], group: string) {
    // Note that it doesn't support preemptive refresh
    return this.inMemoryCache.getManyFromGroup(keys, group)
  }

  public getAsyncOnly(
    key: string,
    group: string,
    resolveParams?: ResolveParams,
  ): Promise<LoadedValue | undefined | null> {
    const groupLoads = this.resolveGroupLoads(group)
    const existingLoad = groupLoads.get(key)
    if (existingLoad) {
      return existingLoad
    }

    const loadingPromise = this.resolveGroupValue(key, group, resolveParams)
    groupLoads.set(key, loadingPromise)

    loadingPromise
      .then((resolvedValue) => {
        if (resolvedValue !== undefined) {
          this.inMemoryCache.setForGroup(key, resolvedValue, group)
        }
        this.deleteGroupRunningLoad(groupLoads, group, key)
      })
      .catch(() => {
        this.deleteGroupRunningLoad(groupLoads, group, key)
      })

    return loadingPromise
  }

  public getManyAsyncOnly(
    keys: string[],
    group: string,
    idResolver: IdResolver<LoadedValue>,
    resolveParams?: ResolveParams,
  ): Promise<GetManyResult<LoadedValue>> {
    // This doesn't support deduplication, and never might, as that would affect perf strongly. Maybe as an opt-in option in the future?
    return this.resolveManyGroupValues(keys, group, idResolver, resolveParams).then((result) => {
      for (let i = 0; i < result.resolvedValues.length; i++) {
        const resolvedValue = result.resolvedValues[i]
        const id = idResolver(resolvedValue)
        this.inMemoryCache.setForGroup(id, resolvedValue, group)
      }
      return result
    })
  }

  public get(key: string, group: string, resolveParams?: ResolveParams): Promise<LoadedValue | undefined | null> {
    const inMemoryValue = this.getInMemoryOnly(key, group, resolveParams)
    if (inMemoryValue !== undefined) {
      return Promise.resolve(inMemoryValue)
    }

    return this.getAsyncOnly(key, group, resolveParams)
  }

  public getMany(
    keys: string[],
    group: string,
    idResolver: IdResolver<LoadedValue>,
    resolveParams?: ResolveParams,
  ): Promise<LoadedValue[]> {
    const inMemoryValues = this.getManyInMemoryOnly(keys, group)
    // everything is in memory, hurray
    if (inMemoryValues.unresolvedKeys.length === 0) {
      return Promise.resolve(inMemoryValues.resolvedValues)
    }

    return this.getManyAsyncOnly(inMemoryValues.unresolvedKeys, group, idResolver, resolveParams).then(
      (asyncRetrievedValues) => {
        return [...inMemoryValues.resolvedValues, ...asyncRetrievedValues.resolvedValues]
      },
    )
  }

  public async invalidateCacheFor(key: string, group: string) {
    this.inMemoryCache.deleteFromGroup(key, group)
    if (this.asyncCache) {
      await this.asyncCache.deleteFromGroup(key, group).catch((err) => {
        this.cacheUpdateErrorHandler(err, undefined, this.asyncCache!, this.logger)
      })
    }

    const groupLoads = this.resolveGroupLoads(group)
    this.deleteGroupRunningLoad(groupLoads, group, key)

    if (this.notificationPublisher) {
      void this.notificationPublisher.deleteFromGroup(key, group).catch((err) => {
        this.notificationPublisher!.errorHandler(err, this.notificationPublisher!.channel, this.logger)
      })
    }
  }

  protected async resolveGroupValue(
    key: string,
    group: string,
    _resolveParams?: ResolveParams,
  ): Promise<LoadedValue | undefined | null> {
    if (this.asyncCache) {
      const cachedValue = await this.asyncCache.getFromGroup(key, group).catch((err) => {
        this.loadErrorHandler(err, key, this.asyncCache!, this.logger)
      })
      if (cachedValue !== undefined) {
        return cachedValue as LoadedValue | undefined | null
      }
    }
    return undefined
  }

  protected async resolveManyGroupValues(
    keys: string[],
    group: string,
    _idResolver: IdResolver<LoadedValue>,
    _resolveParams?: ResolveParams,
  ) {
    if (this.asyncCache) {
      return this.asyncCache.getManyFromGroup(keys, group).catch((err) => {
        this.loadErrorHandler(err, keys.toString(), this.asyncCache!, this.logger)
        return {
          unresolvedKeys: keys,
          resolvedValues: [],
        }
      })
    }
    return {
      unresolvedKeys: keys,
      resolvedValues: [],
    }
  }

  protected resolveGroupLoads(group: string) {
    const load = this.runningLoads.get(group)
    if (load) {
      return load
    }

    const loadCache = new Map()
    this.runningLoads.set(group, loadCache)
    return loadCache
  }

  protected deleteGroupRunningLoad(groupLoads: Map<string, unknown>, group: string, key: string) {
    groupLoads.delete(key)
    if (groupLoads.size === 0) {
      this.runningLoads.delete(group)
    }
  }
}
