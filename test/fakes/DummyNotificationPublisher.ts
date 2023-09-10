import type { NotificationPublisher } from '../../lib/notifications/NotificationPublisher'
import type { DummyNotificationConsumer } from './DummyNotificationConsumer'
import { DEFAULT_NOTIFICATION_ERROR_HANDLER } from '../../lib/notifications/NotificationPublisher'

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

  async set(key: string, value: string) {
    this.consumer.set(key, value)
  }

  async delete(key: string) {
    this.consumer.delete(key)
  }

  async deleteMany(keys: string[]) {
    this.consumer.deleteMany(keys)
  }

  async clear() {
    this.consumer.clear()
  }
}
