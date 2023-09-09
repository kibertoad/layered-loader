import type { PublisherErrorHandler } from '../notifications/NotificationPublisher'
import type { Redis } from 'ioredis'
import { DEFAULT_NOTIFICATION_ERROR_HANDLER } from '../notifications/NotificationPublisher'
import type { GroupNotificationPublisher } from '../notifications/GroupNotificationPublisher'
import type { RedisPublisherConfig } from './RedisNotificationPublisher'

export type GroupNotificationCommand = {
  actionId: typeof CLEAR_COMMAND | typeof DELETE_GROUP_COMMAND | typeof DELETE_FROM_GROUP_COMMAND
  originUuid: string
}

export type DeleteGroupNotificationCommand = GroupNotificationCommand & {
  group: string
}

export type DeleteFromGroupNotificationCommand = DeleteGroupNotificationCommand & {
  key: string
}

export const CLEAR_COMMAND = 'CLEAR'
export const DELETE_GROUP_COMMAND = 'DELETE_GROUP'
export const DELETE_FROM_GROUP_COMMAND = 'DELETE_FROM_GROUP'

export class RedisGroupNotificationPublisher<LoadedValue> implements GroupNotificationPublisher<LoadedValue> {
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
      } satisfies GroupNotificationCommand),
    )
  }

  deleteFromGroup(key: string, group: string): Promise<unknown> {
    return this.redis.publish(
      this.channel,
      JSON.stringify({
        actionId: DELETE_FROM_GROUP_COMMAND,
        key,
        group,
        originUuid: this.serverUuid,
      } satisfies DeleteFromGroupNotificationCommand),
    )
  }

  deleteGroup(group: string): Promise<unknown> {
    return this.redis.publish(
      this.channel,
      JSON.stringify({
        actionId: DELETE_GROUP_COMMAND,
        group,
        originUuid: this.serverUuid,
      } satisfies DeleteGroupNotificationCommand),
    )
  }

  async close() {}

  async subscribe() {}
}
