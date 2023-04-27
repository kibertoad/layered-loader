import type { WriteCache } from '../types/DataSources'

export interface NotificationPublisher<LoadedValue> extends WriteCache<LoadedValue> {
  subscribe(): Promise<unknown>
  close(): Promise<void>
}
