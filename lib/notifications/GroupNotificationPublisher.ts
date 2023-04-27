import type { GroupWriteCache } from '../types/DataSources'

export interface GroupNotificationPublisher<LoadedValue> extends GroupWriteCache<LoadedValue> {
  subscribe(): Promise<unknown>
  close(): Promise<void>
}
