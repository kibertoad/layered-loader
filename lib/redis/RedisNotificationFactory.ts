import { randomUUID } from 'node:crypto'
import type { Redis, RedisOptions } from 'ioredis'
import type { PublisherErrorHandler } from '../notifications/NotificationPublisher.js'
import { RedisNotificationConsumer } from './RedisNotificationConsumer.js'
import { RedisNotificationPublisher } from './RedisNotificationPublisher.js'
import { resolveRedisClient } from './resolveRedisClient.js'

export type RedisNotificationConfig = {
  channel: string
  publisherRedis: Redis | RedisOptions
  consumerRedis: Redis | RedisOptions
  errorHandler?: PublisherErrorHandler
}

export function createNotificationPair<T>(config: RedisNotificationConfig) {
  const resolvedConsumer = resolveRedisClient(config.consumerRedis)
  const resolvedPublisher = resolveRedisClient(config.publisherRedis)

  const serverUuid = randomUUID()
  if (resolvedConsumer === resolvedPublisher) {
    throw new Error(
      'Same Redis client instance cannot be used both for publisher and for consumer, please create a separate connection',
    )
  }

  const consumer = new RedisNotificationConsumer<T>(resolvedConsumer, {
    channel: config.channel,
    serverUuid,
  })

  const publisher = new RedisNotificationPublisher<T>(resolvedPublisher, {
    channel: config.channel,
    errorHandler: config.errorHandler,
    serverUuid,
  })

  return {
    publisher,
    consumer,
  }
}
