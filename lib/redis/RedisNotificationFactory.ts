import { randomUUID } from 'node:crypto'
import type { GlideClientConfiguration } from '@valkey/valkey-glide'
import { GlideClient } from '@valkey/valkey-glide'
import Redis, { type RedisOptions } from 'ioredis'
import type { PublisherErrorHandler } from '../notifications/NotificationPublisher'
import type { RedisClientType } from './RedisClientAdapter'
import { RedisNotificationConsumer } from './RedisNotificationConsumer'
import { RedisNotificationPublisher } from './RedisNotificationPublisher'

export type RedisNotificationConfig = {
  channel: string
  publisherRedis: RedisClientType | RedisOptions | GlideClientConfiguration
  consumerRedis: RedisClientType | RedisOptions | GlideClientConfiguration
  errorHandler?: PublisherErrorHandler
}

export function isClient(maybeClient: unknown): maybeClient is RedisClientType {
  return (
    ('status' in (maybeClient as Redis)) ||
    ('config' in (maybeClient as GlideClient))
  )
}

export async function createNotificationPair<T>(config: RedisNotificationConfig) {
  const resolvedConsumer = isClient(config.consumerRedis) 
    ? config.consumerRedis 
    : 'addresses' in config.consumerRedis
    ? await GlideClient.createClient(config.consumerRedis as GlideClientConfiguration)
    : new Redis(config.consumerRedis as RedisOptions)
  
  const resolvedPublisher = isClient(config.publisherRedis) 
    ? config.publisherRedis 
    : 'addresses' in config.publisherRedis
    ? await GlideClient.createClient(config.publisherRedis as GlideClientConfiguration)
    : new Redis(config.publisherRedis as RedisOptions)

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
