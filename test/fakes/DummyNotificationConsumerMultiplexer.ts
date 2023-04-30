import { AbstractNotificationConsumer } from '../../lib/notifications/AbstractNotificationConsumer'
import type { DummyNotificationConsumer } from './DummyNotificationConsumer'
import type { SynchronousCache } from '../../lib/types/SyncDataSources'

export class DummyNotificationConsumerMultiplexer extends AbstractNotificationConsumer<string> {
  public closed = false
  private notificationConsumers: DummyNotificationConsumer[]

  constructor(notificationConsumers: DummyNotificationConsumer[]) {
    super()
    this.notificationConsumers = notificationConsumers
  }

  setTargetCache(targetCache: SynchronousCache<string>) {
    for (let consumer of this.notificationConsumers) {
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
    for (let consumer of this.notificationConsumers) {
      consumer.set(key, value)
    }
  }

  delete(key: string) {
    for (let consumer of this.notificationConsumers) {
      consumer.delete(key)
    }
  }

  clear() {
    for (let consumer of this.notificationConsumers) {
      consumer.clear()
    }
  }
}
