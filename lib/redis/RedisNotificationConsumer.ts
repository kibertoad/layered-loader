import type { SynchronousCache } from '../types/SyncDataSources'
import { AbstractNotificationConsumer } from '../notifications/AbstractNotificationConsumer'
import type { Redis } from 'ioredis'
import type { DeleteNotificationCommand, NotificationCommand } from './RedisNotificationPublisher'

export type RedisConsumerConfig = {
  channel: string
}

export class RedisNotificationConsumer<LoadedValue> extends AbstractNotificationConsumer<
  LoadedValue,
  SynchronousCache<LoadedValue>
> {
  private readonly redis: Redis
  private readonly channel: string

  constructor(redis: Redis, config: RedisConsumerConfig) {
    super()
    this.redis = redis
    this.channel = config.channel
  }

  async close() {
    await this.redis.unsubscribe(this.channel)
  }

  async subscribe() {
    await this.redis.subscribe(this.channel)

    this.redis.on('message', (channel, message) => {
      const parsedMessage: NotificationCommand = JSON.parse(message)

      if (parsedMessage.actionId === 'CLEAR') {
        return this.targetCache.clear()
      }

      if (parsedMessage.actionId === 'DELETE') {
        return this.targetCache.delete((parsedMessage as DeleteNotificationCommand).key)
      }
    })
  }
}
