import { AbstractNotificationConsumer } from '../../lib/notifications/AbstractNotificationConsumer'
import type { User } from '../types/testTypes'
import type { InMemoryGroupCache } from '../../lib/memory/InMemoryGroupCache'

export class DummyGroupNotificationConsumer extends AbstractNotificationConsumer<User, InMemoryGroupCache<User>> {
  public closed = false

  close(): Promise<void> {
    this.closed = true
    return Promise.resolve(undefined)
  }

  subscribe(): Promise<unknown> {
    return Promise.resolve(undefined)
  }

  setForGroup(key: string, value: User, group: string) {
    this.targetCache.setForGroup(key, value, group)
  }

  deleteFromGroup(key: string, group: string) {
    this.targetCache.deleteFromGroup(key, group)
  }

  deleteGroup(group: string) {
    this.targetCache.deleteGroup(group)
  }

  clear() {
    this.targetCache.clear()
  }
}
