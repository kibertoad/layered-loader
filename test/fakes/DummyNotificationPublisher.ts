import type { NotificationPublisher } from '../../lib/notifications/NotificationPublisher'
import type { DummyNotificationConsumer } from './DummyNotificationConsumer'

export class DummyNotificationPublisher implements NotificationPublisher<string> {
  public closed = false
  private consumer: DummyNotificationConsumer

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

  async clear() {
    this.consumer.clear()
  }
}
