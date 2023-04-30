import type { SynchronousCache } from '../types/SyncDataSources'
import { AbstractNotificationConsumer } from '../notifications/AbstractNotificationConsumer'
import type { Redis } from 'ioredis'
import type { DeleteNotificationCommand, NotificationCommand } from './RedisNotificationPublisher'

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
  private subscribePromise?: Promise<unknown>

  constructor(redis: Redis, config: RedisConsumerConfig) {
    super(config.serverUuid)
    this.redis = redis
    this.channel = config.channel
    this.serverUuid = config.serverUuid
  }

  async close() {
    await this.redis.unsubscribe(this.channel)
  }

  async init() {
    await this.subscribePromise
  }

  subscribe(): Promise<void> {
    this.subscribePromise = this.redis.subscribe(this.channel)
    return this.subscribePromise.then(() => {
      this.redis.on('message', (channel, message) => {
        const parsedMessage: NotificationCommand = JSON.parse(message)
        // this is a local message, ignore
        if (parsedMessage.originUuid === this.serverUuid) {
          return
        }

        if (parsedMessage.actionId === 'CLEAR') {
          return this.targetCache.clear()
        }

        if (parsedMessage.actionId === 'DELETE') {
          return this.targetCache.delete((parsedMessage as DeleteNotificationCommand).key)
        }
      })
    })
  }
}
