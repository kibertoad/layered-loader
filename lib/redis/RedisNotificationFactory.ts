import { randomUUID } from 'node:crypto'
import {Redis, RedisOptions} from 'ioredis'
import type { PublisherErrorHandler } from '../notifications/NotificationPublisher'
import { RedisNotificationConsumer } from './RedisNotificationConsumer'
import { RedisNotificationPublisher } from './RedisNotificationPublisher'
import { enrichRedisConfig } from './enrichRedisConfig'

export type RedisNotificationConfig = {
  channel: string
  publisherRedis: Redis | RedisOptions
  consumerRedis: Redis | RedisOptions
  errorHandler?: PublisherErrorHandler
  /**
   * Optional explicit server identifier. When omitted, a random UUID is
   * generated on every pair creation. Override this when the local consumer
   * must distinguish messages emitted by a different `NotificationPublisher`
   * instance (e.g. an `SqsInvalidationTrigger` republishing through Redis)
   * from its own — the consumer skips commands whose `originUuid` matches
   * its own `serverUuid`.
   */
  serverUuid?: string
}

export function isClient(maybeClient: unknown): maybeClient is Redis {
  return 'status' in (maybeClient as Redis)
}

export function createNotificationPair<T>(config: RedisNotificationConfig) {
  const resolvedConsumer = isClient(config.consumerRedis) ? config.consumerRedis : new Redis(enrichRedisConfig(config.consumerRedis))
  const resolvedPublisher = isClient(config.publisherRedis) ? config.publisherRedis : new Redis(enrichRedisConfig(config.publisherRedis))

  const serverUuid = config.serverUuid ?? randomUUID()
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
