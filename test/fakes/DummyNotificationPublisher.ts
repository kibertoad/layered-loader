import type { NotificationPublisher } from '../../lib/notifications/NotificationPublisher'
import { DEFAULT_NOTIFICATION_ERROR_HANDLER } from '../../lib/notifications/NotificationPublisher'
import type { DummyNotificationConsumer } from './DummyNotificationConsumer'

export class DummyNotificationPublisher implements NotificationPublisher<string> {
  public closed = false
  private consumer: DummyNotificationConsumer
  public errorHandler = DEFAULT_NOTIFICATION_ERROR_HANDLER
  public channel = 'dummy'

  constructor(consumer: DummyNotificationConsumer) {
    this.consumer = consumer
  }

  close(): Promise<void> {
    this.closed = true
    return Promise.resolve(undefined)
  }

  subscribe(): Promise<unknown> {
    return Promise.resolve(undefined)
  }

  set(key: string, value: string | null): Promise<unknown> {
    this.consumer.set(key, value as string)
    return Promise.resolve()
  }

  delete(key: string) {
    this.consumer.delete(key)
    return Promise.resolve()
  }

  deleteMany(keys: string[]) {
    this.consumer.deleteMany(keys)
    return Promise.resolve()
  }

  clear() {
    this.consumer.clear()
    return Promise.resolve()
  }
}
