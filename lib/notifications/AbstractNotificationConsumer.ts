import type { SynchronousCache, SynchronousGroupCache } from '../types/SyncDataSources'
import type { Logger } from '../util/Logger'

export type ConsumerErrorHandler = (err: Error, channel: string, logger: Logger) => void

/* v8 ignore next -- @preserve */
export const DEFAULT_NOTIFICATION_ERROR_HANDLER: ConsumerErrorHandler = (err, serverUuid, logger) => {
  logger.error(`Notification consumer error for server UUID ${serverUuid}: ${err.message}`)
}

export abstract class AbstractNotificationConsumer<
  LoadedValue,
  InMemoryCacheType extends
    | SynchronousCache<LoadedValue>
    | SynchronousGroupCache<LoadedValue> = SynchronousCache<LoadedValue>,
> {
  // @ts-ignore
  protected targetCache: InMemoryCacheType
  public readonly errorHandler: ConsumerErrorHandler
  public serverUuid: string

  constructor(serverUuid: string, errorHandler?: ConsumerErrorHandler) {
    this.serverUuid = serverUuid
    this.errorHandler = errorHandler ?? DEFAULT_NOTIFICATION_ERROR_HANDLER
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
