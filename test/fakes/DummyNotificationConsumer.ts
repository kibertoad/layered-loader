import { AbstractNotificationConsumer } from '../../lib/notifications/AbstractNotificationConsumer'

export class DummyNotificationConsumer extends AbstractNotificationConsumer<string> {
  public closed = false

  close(): Promise<void> {
    this.closed = true
    return Promise.resolve(undefined)
  }

  subscribe(): Promise<unknown> {
    return Promise.resolve(undefined)
  }

  set(key: string, value: string) {
    this.targetCache.set(key, value)
  }

  invalidate(key: string) {
    this.targetCache.delete(key)
  }
}
