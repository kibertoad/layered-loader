import { randomUUID } from 'node:crypto'
import type { GlideClientConfiguration } from '@valkey/valkey-glide'
import { GlideClient } from '@valkey/valkey-glide'
import Redis, { type RedisOptions } from 'ioredis'
import { RedisGroupNotificationConsumer } from './RedisGroupNotificationConsumer'
import { RedisGroupNotificationPublisher } from './RedisGroupNotificationPublisher'
import { isClient, type RedisNotificationConfig } from './RedisNotificationFactory'

export async function createGroupNotificationPair<T>(config: RedisNotificationConfig) {
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
  if (resolvedPublisher === resolvedConsumer) {
    throw new Error(
      'Same Redis client instance cannot be used both for publisher and for consumer, please create a separate connection',
    )
  }

  const consumer = new RedisGroupNotificationConsumer<T>(resolvedConsumer, {
    channel: config.channel,
    serverUuid,
  })

  const publisher = new RedisGroupNotificationPublisher<T>(resolvedPublisher, {
    channel: config.channel,
    errorHandler: config.errorHandler,
    serverUuid,
  })

  return {
    publisher,
    consumer,
  }
}
