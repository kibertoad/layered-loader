import type { Redis } from 'ioredis'
import { AbstractNotificationConsumer } from '../notifications/AbstractNotificationConsumer'
import type { SynchronousCache } from '../types/SyncDataSources'
import type {
  DeleteManyNotificationCommand,
  DeleteNotificationCommand,
  NotificationCommand,
  SetNotificationCommand,
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

  async close(): Promise<void> {
    try {
      await this.redis.unsubscribe(this.channel)
    } catch {
      // Connection may already be closed
    }
    return new Promise((resolve) => {
      void this.redis.quit((_err, result) => {
        return resolve()
      })
    })
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

        if (parsedMessage.actionId === 'SET') {
          return this.targetCache.set(
            (parsedMessage as SetNotificationCommand<LoadedValue>).key,
            (parsedMessage as SetNotificationCommand<LoadedValue>).value,
          )
        }
      })
    })
  }
}
