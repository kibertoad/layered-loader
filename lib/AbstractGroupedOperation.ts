import { AbstractOperation } from './AbstractOperation'
import { GroupedCache } from './types/DataSources'

export abstract class AbstractGroupedOperation<LoadedValue, ResolveParams = undefined> extends AbstractOperation<
  LoadedValue,
  Map<string, Promise<LoadedValue | undefined | null> | undefined>,
  GroupedCache<LoadedValue>
> {
  public async invalidateCacheForGroup(group: string) {
    if (this.asyncCache) {
      await this.asyncCache.deleteGroup(group).catch((err) => {
        this.cacheUpdateErrorHandler(err, `group: ${group}`, this.asyncCache!, this.logger)
      })
    }

    this.inMemoryCache.deleteGroup(group)
    this.runningLoads.delete(group)
  }

  public getInMemoryOnly(key: string, group: string): LoadedValue | undefined | null {
    return this.inMemoryCache.getFromGroup(key, group)
  }

  public getAsyncOnly(
    key: string,
    group: string,
    resolveParams?: ResolveParams
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

  public get(key: string, group: string, resolveParams?: ResolveParams): Promise<LoadedValue | undefined | null> {
    const inMemoryValue = this.inMemoryCache.getFromGroup(key, group)
    if (inMemoryValue !== undefined) {
      return Promise.resolve(inMemoryValue)
    }

    return this.getAsyncOnly(key, group, resolveParams)
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
  }

  protected async resolveGroupValue(
    key: string,
    group: string,
    _resolveParams?: ResolveParams
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
