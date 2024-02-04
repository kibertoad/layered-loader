import { randomUUID } from 'node:crypto'
import type { InMemoryGroupCache } from '../../lib/memory/InMemoryGroupCache'
import { AbstractNotificationConsumer } from '../../lib/notifications/AbstractNotificationConsumer'
import type { User } from '../types/testTypes'
import type { DummyGroupNotificationConsumer } from './DummyGroupNotificationConsumer'

export class DummyGroupNotificationConsumerMultiplexer extends AbstractNotificationConsumer<
  User,
  InMemoryGroupCache<User>
> {
  public closed = false
  private notificationConsumers: DummyGroupNotificationConsumer[]

  constructor(notificationConsumers: DummyGroupNotificationConsumer[]) {
    super(randomUUID())
    this.notificationConsumers = notificationConsumers
  }

  setTargetCache(targetCache: InMemoryGroupCache<User>) {
    for (var consumer of this.notificationConsumers) {
      // @ts-ignore
      if (!consumer.targetCache) {
        consumer.setTargetCache(targetCache)
      }
    }
  }

  close(): Promise<void> {
    this.closed = true
    return Promise.resolve(undefined)
  }

  subscribe(): Promise<unknown> {
    return Promise.resolve(undefined)
  }

  setForGroup(key: string, value: User, group: string) {
    for (var consumer of this.notificationConsumers) {
      consumer.setForGroup(key, value, group)
    }
  }

  deleteFromGroup(key: string, group: string) {
    for (var consumer of this.notificationConsumers) {
      consumer.deleteFromGroup(key, group)
    }
  }

  deleteGroup(group: string) {
    for (var consumer of this.notificationConsumers) {
      consumer.deleteGroup(group)
    }
  }

  clear() {
    for (var consumer of this.notificationConsumers) {
      consumer.clear()
    }
  }
}
