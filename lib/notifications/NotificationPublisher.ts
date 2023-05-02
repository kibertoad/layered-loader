import type { WriteCache } from '../types/DataSources'
import type { Logger } from '../util/Logger'

export type PublisherErrorHandler = (err: Error, channel: string, logger: Logger) => void

export const DEFAULT_NOTIFICATION_ERROR_HANDLER: PublisherErrorHandler = (err, channel, logger) => {
  logger.error(`Error while publishing notification to channel ${channel}: ${err.message}`)
}

export interface NotificationPublisher<LoadedValue> extends Pick<WriteCache<LoadedValue>, 'delete' | 'clear'> {
  subscribe(): Promise<unknown>
  close(): Promise<void>
}
