import { randomUUID } from 'node:crypto'
import { AbstractNotificationConsumer } from '../../lib/notifications/AbstractNotificationConsumer'
import type { SynchronousCache } from '../../lib/types/SyncDataSources'
import type { DummyNotificationConsumer } from './DummyNotificationConsumer'

export class DummyNotificationConsumerMultiplexer extends AbstractNotificationConsumer<string> {
  public closed = false
  private notificationConsumers: DummyNotificationConsumer[]

  constructor(notificationConsumers: DummyNotificationConsumer[]) {
    super(randomUUID())
    this.notificationConsumers = notificationConsumers
  }

  setTargetCache(targetCache: SynchronousCache<string>) {
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

  set(key: string, value: string) {
    for (var consumer of this.notificationConsumers) {
      consumer.set(key, value)
    }
  }

  delete(key: string) {
    for (var consumer of this.notificationConsumers) {
      consumer.delete(key)
    }
  }

  clear() {
    for (var consumer of this.notificationConsumers) {
      consumer.clear()
    }
  }

  deleteMany(keys: string[]) {
    for (var consumer of this.notificationConsumers) {
      consumer.deleteMany(keys)
    }
  }
}
