import type { SynchronousCache, SynchronousGroupCache } from '../types/SyncDataSources'

export abstract class AbstractNotificationConsumer<
  LoadedValue,
  InMemoryCacheType extends
    | SynchronousCache<LoadedValue>
    | SynchronousGroupCache<LoadedValue> = SynchronousCache<LoadedValue>,
> {
  // @ts-ignore
  protected targetCache: InMemoryCacheType
  protected serverUuid: string

  constructor(serverUuid: string) {
    this.serverUuid = serverUuid
  }

  setTargetCache(targetCache: InMemoryCacheType) {
    if (this.targetCache) {
      throw new Error('Cannot modify already set target cache')
    }
    this.targetCache = targetCache
  }

  abstract subscribe(): Promise<unknown>
  abstract close(): Promise<void>
}
