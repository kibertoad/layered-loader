import type { SynchronousCache } from '../types/SyncDataSources'
import { AbstractNotificationConsumer } from '../notifications/AbstractNotificationConsumer'
import type { Redis } from 'ioredis'
import type {
  DeleteManyNotificationCommand,
  DeleteNotificationCommand,
  NotificationCommand,
} from './RedisNotificationPublisher'

export type RedisConsumerConfig = {
  channel: string
  serverUuid: string
}

export class RedisNotificationConsumer<LoadedValue> extends AbstractNotificationConsumer<
  LoadedValue,
  SynchronousCache<LoadedValue>
> {
  private readonly redis: Redis
  private readonly channel: string

  constructor(redis: Redis, config: RedisConsumerConfig) {
    super(config.serverUuid)
    this.redis = redis
    this.channel = config.channel
  }

  async close() {
    await this.redis.unsubscribe(this.channel)
  }

  subscribe(): Promise<void> {
    return this.redis.subscribe(this.channel).then(() => {
      this.redis.on('message', (channel, message) => {
        const parsedMessage: NotificationCommand = JSON.parse(message)
        // this is a local message, ignore
        if (parsedMessage.originUuid === this.serverUuid) {
          return
        }

        if (parsedMessage.actionId === 'DELETE') {
          return this.targetCache.delete((parsedMessage as DeleteNotificationCommand).key)
        }

        if (parsedMessage.actionId === 'DELETE_MANY') {
          return this.targetCache.deleteMany((parsedMessage as DeleteManyNotificationCommand).keys)
        }

        if (parsedMessage.actionId === 'CLEAR') {
          return this.targetCache.clear()
        }
      })
    })
  }
}
