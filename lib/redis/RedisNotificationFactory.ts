import { randomUUID } from 'node:crypto'
import {Redis, RedisOptions} from 'ioredis'
import type { PublisherErrorHandler } from '../notifications/NotificationPublisher'
import { RedisNotificationConsumer } from './RedisNotificationConsumer'
import { RedisNotificationPublisher } from './RedisNotificationPublisher'

export type RedisNotificationConfig = {
  channel: string
  publisherRedis: Redis | RedisOptions
  consumerRedis: Redis | RedisOptions
  errorHandler?: PublisherErrorHandler
}

export function isClient(maybeClient: unknown): maybeClient is Redis {
  return 'status' in (maybeClient as Redis)
}

export function createNotificationPair<T>(config: RedisNotificationConfig) {
  const resolvedConsumer = isClient(config.consumerRedis) ? config.consumerRedis : new Redis(config.consumerRedis)
  const resolvedPublisher = isClient(config.publisherRedis) ? config.publisherRedis : new Redis(config.publisherRedis)

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
