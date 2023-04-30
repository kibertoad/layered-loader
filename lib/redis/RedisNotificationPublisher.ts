import type { NotificationPublisher } from '../notifications/NotificationPublisher'
import type { Redis } from 'ioredis'

export type RedisPublisherConfig = {
  channel: string
}

export type NotificationCommand = {
  actionId: typeof CLEAR_COMMAND | typeof DELETE_COMMAND
}

export type DeleteNotificationCommand = NotificationCommand & {
  key: string
}

export const CLEAR_COMMAND = 'CLEAR'
export const DELETE_COMMAND = 'DELETE'

export class RedisNotificationPublisher<LoadedValue> implements NotificationPublisher<LoadedValue> {
  private readonly redis: Redis
  private readonly channel: string

  constructor(redis: Redis, config: RedisPublisherConfig) {
    this.redis = redis
    this.channel = config.channel
  }

  async clear(): Promise<void> {
    await this.redis.publish(
      this.channel,
      JSON.stringify({
        actionId: CLEAR_COMMAND,
      } satisfies NotificationCommand)
    )
  }

  async delete(key: string) {
    await this.redis.publish(
      this.channel,
      JSON.stringify({
        actionId: DELETE_COMMAND,
        key,
      } satisfies DeleteNotificationCommand)
    )
  }

  async close(): Promise<void> {
    //await this.redis.unsubscribe(this.channel)
  }

  async subscribe() {
    //await this.redis.subscribe(this.channel)
  }
}
