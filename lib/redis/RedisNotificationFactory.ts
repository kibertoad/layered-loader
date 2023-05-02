import type { Redis } from 'ioredis'
import { RedisNotificationConsumer } from './RedisNotificationConsumer'
import { RedisNotificationPublisher } from './RedisNotificationPublisher'
import { randomUUID } from 'node:crypto'

export type RedisNotificationConfig = {
  channel: string
  publisherRedis: Redis
  consumerRedis: Redis
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
    serverUuid,
  })

  return {
    publisher,
    consumer,
  }
}
