import type { NotificationPublisher } from '../notifications/NotificationPublisher'
import type { Redis } from 'ioredis'

export type RedisPublisherConfig = {
  serverUuid: string
  channel: string
}

export type NotificationCommand = {
  actionId: typeof CLEAR_COMMAND | typeof DELETE_COMMAND
  originUuid: string
}

export type DeleteNotificationCommand = NotificationCommand & {
  key: string
}

export const CLEAR_COMMAND = 'CLEAR'
export const DELETE_COMMAND = 'DELETE'

export class RedisNotificationPublisher<LoadedValue> implements NotificationPublisher<LoadedValue> {
  private readonly redis: Redis
  private readonly channel: string
  private readonly serverUuid: string

  constructor(redis: Redis, config: RedisPublisherConfig) {
    this.redis = redis
    this.channel = config.channel
    this.serverUuid = config.serverUuid
  }

  async clear(): Promise<void> {
    await this.redis.publish(
      this.channel,
      JSON.stringify({
        actionId: CLEAR_COMMAND,
        originUuid: this.serverUuid,
      } satisfies NotificationCommand)
    )
  }

  async delete(key: string) {
    await this.redis.publish(
      this.channel,
      JSON.stringify({
        actionId: DELETE_COMMAND,
        originUuid: this.serverUuid,
        key,
      } satisfies DeleteNotificationCommand)
    )
  }

  async close() {}

  async subscribe() {}
}
