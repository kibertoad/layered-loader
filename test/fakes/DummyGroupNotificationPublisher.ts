import type { GroupNotificationPublisher } from '../../lib/notifications/GroupNotificationPublisher'
import { DEFAULT_NOTIFICATION_ERROR_HANDLER } from '../../lib/notifications/NotificationPublisher'
import type { User } from '../types/testTypes'
import type { DummyGroupNotificationConsumer } from './DummyGroupNotificationConsumer'

export class DummyGroupNotificationPublisher implements GroupNotificationPublisher<User> {
  public closed = false
  private consumer: DummyGroupNotificationConsumer
  public errorHandler = DEFAULT_NOTIFICATION_ERROR_HANDLER
  public channel = 'dummy'

  constructor(consumer: DummyGroupNotificationConsumer) {
    this.consumer = consumer
  }

  close(): Promise<void> {
    this.closed = true
    return Promise.resolve(undefined)
  }

  subscribe(): Promise<unknown> {
    return Promise.resolve(undefined)
  }

  async deleteFromGroup(key: string, group: string) {
    this.consumer.deleteFromGroup(key, group)
  }

  async deleteGroup(group: string) {
    this.consumer.deleteGroup(group)
  }

  async setForGroup(key: string, value: User, group: string) {
    this.consumer.setForGroup(key, value, group)
  }

  async clear() {
    this.consumer.clear()
  }
}
