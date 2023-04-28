import type { GroupWriteCache } from '../types/DataSources'

export interface GroupNotificationPublisher<LoadedValue>
  extends Pick<GroupWriteCache<LoadedValue>, 'deleteFromGroup' | 'deleteGroup' | 'clear'> {
  subscribe(): Promise<unknown>
  close(): Promise<void>
}
