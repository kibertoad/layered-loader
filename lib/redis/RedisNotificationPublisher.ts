import type { NotificationPublisher, PublisherErrorHandler } from '../notifications/NotificationPublisher'
import type { Redis } from 'ioredis'
import { DEFAULT_NOTIFICATION_ERROR_HANDLER } from '../notifications/NotificationPublisher'
import type { Logger } from '../util/Logger'

export type RedisPublisherConfig = {
  serverUuid: string
  channel: string
  errorHandler?: PublisherErrorHandler
  logger?: Logger
}

export type NotificationCommand = {
  actionId: typeof CLEAR_COMMAND | typeof DELETE_COMMAND | typeof DELETE_MANY_COMMAND
  originUuid: string
}

export type DeleteNotificationCommand = NotificationCommand & {
  key: string
}

export type DeleteManyNotificationCommand = NotificationCommand & {
  keys: string[]
}

export const CLEAR_COMMAND = 'CLEAR'
export const DELETE_COMMAND = 'DELETE'
export const DELETE_MANY_COMMAND = 'DELETE_MANY'

export class RedisNotificationPublisher<LoadedValue> implements NotificationPublisher<LoadedValue> {
  public readonly channel: string
  public readonly errorHandler: PublisherErrorHandler

  private readonly redis: Redis
  private readonly serverUuid: string

  constructor(redis: Redis, config: RedisPublisherConfig) {
    this.redis = redis
    this.channel = config.channel
    this.serverUuid = config.serverUuid
    this.errorHandler = config.errorHandler ?? DEFAULT_NOTIFICATION_ERROR_HANDLER
  }

  clear(): Promise<unknown> {
    return this.redis.publish(
      this.channel,
      JSON.stringify({
        actionId: CLEAR_COMMAND,
        originUuid: this.serverUuid,
      } satisfies NotificationCommand),
    )
  }

  delete(key: string): Promise<unknown> {
    return this.redis.publish(
      this.channel,
      JSON.stringify({
        actionId: DELETE_COMMAND,
        originUuid: this.serverUuid,
        key,
      } satisfies DeleteNotificationCommand),
    )
  }

  deleteMany(keys: string[]): Promise<unknown> {
    return this.redis.publish(
      this.channel,
      JSON.stringify({
        actionId: DELETE_MANY_COMMAND,
        originUuid: this.serverUuid,
        keys,
      } satisfies DeleteManyNotificationCommand),
    )
  }

  async close() {}

  async subscribe() {}
}
