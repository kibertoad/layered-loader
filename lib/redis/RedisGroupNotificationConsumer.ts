import type { Redis } from 'ioredis'
import type { InMemoryGroupCache } from '../memory/InMemoryGroupCache'
import { AbstractNotificationConsumer } from '../notifications/AbstractNotificationConsumer'
import type {
  DeleteFromGroupNotificationCommand,
  DeleteGroupNotificationCommand,
  GroupNotificationCommand,
} from './RedisGroupNotificationPublisher'
import type { RedisConsumerConfig } from './RedisNotificationConsumer'

export class RedisGroupNotificationConsumer<LoadedValue> extends AbstractNotificationConsumer<
  LoadedValue,
  InMemoryGroupCache<LoadedValue>
> {
  private readonly redis: Redis
  private readonly channel: string

  constructor(redis: Redis, config: RedisConsumerConfig) {
    super(config.serverUuid)
    this.redis = redis
    this.channel = config.channel
  }

  async close(): Promise<void> {
    await this.redis.unsubscribe(this.channel)
    return new Promise((resolve) => {
      void this.redis.quit((_err, result) => {
        return resolve()
      })
    })
  }

  subscribe(): Promise<void> {
    return this.redis.subscribe(this.channel).then(() => {
      this.redis.on('message', (channel, message) => {
        const parsedMessage: GroupNotificationCommand = JSON.parse(message)
        // this is a local message, ignore
        if (parsedMessage.originUuid === this.serverUuid) {
          return
        }

        if (parsedMessage.actionId === 'DELETE_FROM_GROUP') {
          return this.targetCache.deleteFromGroup(
            (parsedMessage as DeleteFromGroupNotificationCommand).key,
            (parsedMessage as DeleteFromGroupNotificationCommand).group,
          )
        }

        if (parsedMessage.actionId === 'DELETE_GROUP') {
          return this.targetCache.deleteGroup((parsedMessage as DeleteGroupNotificationCommand).group)
        }

        if (parsedMessage.actionId === 'CLEAR') {
          return this.targetCache.clear()
        }
      })
    })
  }
}
