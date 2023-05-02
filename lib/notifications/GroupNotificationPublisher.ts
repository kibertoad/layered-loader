import type { GroupWriteCache } from '../types/DataSources'
import type { PublisherErrorHandler } from './NotificationPublisher'

export interface GroupNotificationPublisher<LoadedValue>
  extends Pick<GroupWriteCache<LoadedValue>, 'deleteFromGroup' | 'deleteGroup' | 'clear'> {
  readonly errorHandler: PublisherErrorHandler
  readonly channel: string

  subscribe(): Promise<unknown>
  close(): Promise<void>
}
