import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'
import type { PublisherErrorHandler } from '../notifications/NotificationPublisher'
import { RedisNotificationConsumer } from './RedisNotificationConsumer'
import { RedisNotificationPublisher } from './RedisNotificationPublisher'

export type RedisNotificationConfig = {
  channel: string
  publisherRedis: Redis
  consumerRedis: Redis
  errorHandler?: PublisherErrorHandler
}

export function createNotificationPair<T>(config: RedisNotificationConfig) {
  const serverUuid = randomUUID()
  if (config.publisherRedis === config.consumerRedis) {
    throw new Error(
      'Same Redis client instance cannot be used both for publisher and for consumer, please create a separate connection',
    )
  }

  const consumer = new RedisNotificationConsumer<T>(config.consumerRedis, {
    channel: config.channel,
    serverUuid,
  })

  const publisher = new RedisNotificationPublisher<T>(config.publisherRedis, {
    channel: config.channel,
    errorHandler: config.errorHandler,
    serverUuid,
  })

  return {
    publisher,
    consumer,
  }
}
