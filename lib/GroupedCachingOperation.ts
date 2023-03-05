import { GroupedCache } from './types/DataSources'
import { AbstractOperation, CommonOperationConfig, LoadEntry } from './AbstractOperation'

export type GroupedCachingOperationConfig<LoadedValue> = CommonOperationConfig<LoadedValue, GroupedCache<LoadedValue>>

export class GroupedCachingOperation<LoadedValue> extends AbstractOperation<
  LoadedValue,
  Map<string, LoadEntry<LoadedValue | undefined | null, Promise<LoadedValue | undefined | null>>>,
  GroupedCache<LoadedValue>
> {
  constructor(config: GroupedCachingOperationConfig<LoadedValue>) {
    super(config)
  }

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

  public async getAsyncOnly(key: string, group: string): Promise<LoadedValue | undefined | null> {
    const groupLoads = this.resolveGroupLoads(group)
    const existingLoad = groupLoads.get(key)
    if (existingLoad) {
      existingLoad.counter++
      if (existingLoad.counter > this.maxBatchedOperationsPerLoad) {
        this.deleteGroupRunningLoad(groupLoads, group, key)
      }
      return existingLoad.promise
    }

    const loadingPromise = this.resolveGroupValue(key, group)
    groupLoads.set(key, new LoadEntry(loadingPromise))

    const resolvedValue = await loadingPromise
    if (resolvedValue === undefined) {
      if (this.throwIfUnresolved) {
        this.deleteGroupRunningLoad(groupLoads, group, key)
        throw new Error(`Failed to resolve value for key "${key}", group ${group}`)
      }
    } else {
      this.inMemoryCache.setForGroup(key, resolvedValue, group)
    }
    this.deleteGroupRunningLoad(groupLoads, group, key)
    return resolvedValue
  }

  public async get(key: string, group: string): Promise<LoadedValue | undefined | null> {
    const inMemoryValue = this.inMemoryCache.getFromGroup(key, group)
    if (inMemoryValue !== undefined) {
      return inMemoryValue
    }

    return this.getAsyncOnly(key, group)
  }

  public async set(key: string, resolvedValue: LoadedValue, group: string): Promise<void> {
    this.inMemoryCache.setForGroup(key, resolvedValue, group)
    const groupLoads = this.resolveGroupLoads(group)
    this.deleteGroupRunningLoad(groupLoads, group, key)
    if (this.asyncCache) {
      return this.asyncCache.setForGroup(key, resolvedValue, group).catch((err) => {
        this.cacheUpdateErrorHandler(err, key, this.asyncCache!, this.logger)
      })
    }
  }

  private async resolveGroupValue(key: string, group: string): Promise<LoadedValue | undefined | null> {
    if (this.asyncCache) {
      const cachedValue = await this.asyncCache.getFromGroup(key, group).catch((err) => {
        this.loadErrorHandler(err, key, this.asyncCache!, this.logger)
      })
      return cachedValue as LoadedValue | undefined | null
    }
    return undefined
  }

  private resolveGroupLoads(
    group: string
  ): Map<string, LoadEntry<LoadedValue | undefined | null, Promise<LoadedValue | undefined | null>>> {
    const groupLoads = this.runningLoads.get(group)
    if (groupLoads) {
      return groupLoads
    }

    const newGroupLoads = new Map()
    this.runningLoads.set(group, newGroupLoads)
    return newGroupLoads
  }

  private deleteGroupRunningLoad(groupLoads: Map<string, unknown>, group: string, key: string) {
    groupLoads.delete(key)
    if (groupLoads.size === 0) {
      this.runningLoads.delete(group)
    }
  }
}
