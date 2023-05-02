import type { Redis } from 'ioredis'
import { RedisNotificationConsumer } from './RedisNotificationConsumer'
import { RedisNotificationPublisher } from './RedisNotificationPublisher'
import { randomUUID } from 'node:crypto'
import type { PublisherErrorHandler } from '../notifications/NotificationPublisher'
import type { Logger } from '../util/Logger'

export type RedisNotificationConfig = {
  channel: string
  publisherRedis: Redis
  consumerRedis: Redis
  errorHandler?: PublisherErrorHandler
  logger?: Logger
}

export function createNotificationPair(config: RedisNotificationConfig) {
  const serverUuid = randomUUID()
  if (config.publisherRedis === config.consumerRedis) {
    throw new Error(
      'Same Redis client instance cannot be used both for publisher and for consumer, please create a separate connection'
    )
  }

  const consumer = new RedisNotificationConsumer(config.consumerRedis, {
    channel: config.channel,
    serverUuid,
  })

  const publisher = new RedisNotificationPublisher(config.publisherRedis, {
    channel: config.channel,
    errorHandler: config.errorHandler,
    serverUuid,
    logger: config.logger,
  })

  return {
    publisher,
    consumer,
  }
}
