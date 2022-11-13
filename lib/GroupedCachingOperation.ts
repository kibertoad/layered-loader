import { GroupedCache } from './DataSources'
import { LRU, lru } from 'tiny-lru'
import { CachingOperationConfig, DEFAULT_CACHING_OPERATION_CONFIG } from './CachingOperation'

export type GroupedCachingOperationConfig = CachingOperationConfig & {
  loadingOperationGroupsMemorySize: number
  loadingOperationGroupsMemoryTtl: number
}

export const DEFAULT_GROUPED_CACHING_OPERATION_CONFIG: GroupedCachingOperationConfig = {
  ...DEFAULT_CACHING_OPERATION_CONFIG,
  loadingOperationGroupsMemorySize: 100,
  loadingOperationGroupsMemoryTtl: 1000 * 30,
}

export class GroupedCachingOperation<LoadedValue> {
  private readonly params: GroupedCachingOperationConfig
  private readonly caches: readonly GroupedCache<LoadedValue>[]
  private readonly cacheIndexes: readonly number[]
  private readonly runningLoads: LRU<LRU<Promise<LoadedValue | undefined | null> | undefined>>

  constructor(
    caches: readonly GroupedCache<LoadedValue>[],
    params: Partial<GroupedCachingOperationConfig> = DEFAULT_GROUPED_CACHING_OPERATION_CONFIG
  ) {
    this.params = {
      ...DEFAULT_GROUPED_CACHING_OPERATION_CONFIG,
      ...params,
    }
    this.caches = caches
    this.runningLoads = lru(params.loadingOperationMemorySize, params.loadingOperationMemoryTtl)
    this.cacheIndexes = caches.reduce((result, _value, index) => {
      result.push(index)
      return result
    }, [] as number[])
  }

  public invalidateCache() {
    const promises: Promise<any>[] = []
    this.runningLoads.clear()

    this.cacheIndexes.forEach((cacheIndex) => {
      promises.push(
        Promise.resolve()
          .then(() => {
            return (this.caches[cacheIndex] as unknown as GroupedCache<LoadedValue>).clear()
          })
          .catch((err) => {
            this.params.cacheUpdateErrorHandler(err, undefined, this.caches[cacheIndex], this.params.logger)
          })
      )
    })

    return Promise.all(promises)
  }

  public invalidateCacheForGroup(group: string) {
    const promises: Promise<any>[] = []
    this.runningLoads.delete(group)

    this.cacheIndexes.forEach((cacheIndex) => {
      promises.push(
        Promise.resolve()
          .then(() => {
            return (this.caches[cacheIndex] as unknown as GroupedCache<LoadedValue>).deleteGroup(group)
          })
          .catch((err) => {
            this.params.cacheUpdateErrorHandler(err, `group: ${group}`, this.caches[cacheIndex], this.params.logger)
          })
      )
    })
    return Promise.all(promises)
  }

  private async resolveValue(key: string, group: string): Promise<LoadedValue | undefined | null> {
    for (let index = 0; index < this.caches.length; index++) {
      const resolvedValue = await Promise.resolve()
        .then(() => {
          return this.caches[index].getFromGroup(key, group)
        })
        .catch((err) => {
          this.params.loadErrorHandler(err, key, this.caches[index], this.params.logger)

          // if last loader, fail
          if (index === this.caches.length - 1) {
            throw new Error(`Failed to resolve value for key "${key}": ${err.message}`, { cause: err })
          }
        })

      if (resolvedValue) {
        // update caches
        this.cacheIndexes
          .filter((cacheIndex) => {
            return cacheIndex < index
          })
          .forEach((cacheIndex) => {
            Promise.resolve()
              .then(() => {
                return (this.caches[cacheIndex] as unknown as GroupedCache<LoadedValue>).setForGroup(
                  key,
                  resolvedValue,
                  group
                )
              })
              .catch((err) => {
                this.params.cacheUpdateErrorHandler(err, key, this.caches[cacheIndex], this.params.logger)
              })
          })

        return resolvedValue
      }
    }
    return undefined
  }

  public async get(key: string, group: string): Promise<LoadedValue | undefined | null> {
    const groupLoads = this.resolveGroupLoads(group)
    const existingLoad = groupLoads.get(key)
    if (existingLoad) {
      return existingLoad
    }

    const loadingPromise = this.resolveValue(key, group)
    groupLoads.set(key, loadingPromise)
    return loadingPromise
  }

  private resolveGroupLoads(group: string) {
    const load = this.runningLoads.get(group)

    if (load) {
      return load
    }

    const loadCache = lru(this.params.loadingOperationGroupsMemorySize, this.params.loadingOperationGroupsMemoryTtl)
    this.runningLoads.set(group, loadCache)
    return loadCache
  }

  public async set(key: string, resolvedValue: LoadedValue, group: string): Promise<void> {
    const promises = []
    const groupLoads = this.resolveGroupLoads(group)
    groupLoads.delete(key)

    for (let cache of this.caches) {
      const promise = Promise.resolve()
        .then(() => {
          return cache.setForGroup(key, resolvedValue, group)
        })
        .catch((err) => {
          this.params.cacheUpdateErrorHandler(err, key, cache, this.params.logger)
        })
      promises.push(promise)
    }
    await Promise.all(promises)
  }
}
