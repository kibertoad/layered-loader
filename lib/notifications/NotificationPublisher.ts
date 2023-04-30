import type { WriteCache } from '../types/DataSources'

export interface NotificationPublisher<LoadedValue> extends Pick<WriteCache<LoadedValue>, 'delete' | 'clear'> {
  subscribe(): Promise<unknown>
  close(): Promise<void>
}
