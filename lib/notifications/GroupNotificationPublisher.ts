import type { GroupWriteCache } from '../types/DataSources.js'
import type { PublisherErrorHandler } from './NotificationPublisher.js'

export interface GroupNotificationPublisher<LoadedValue>
  extends Pick<GroupWriteCache<LoadedValue>, 'deleteFromGroup' | 'deleteGroup' | 'clear'> {
  readonly errorHandler: PublisherErrorHandler
  readonly channel: string

  subscribe(): Promise<unknown>
  close(): Promise<void>
}
