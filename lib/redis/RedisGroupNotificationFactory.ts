import { randomUUID } from 'node:crypto'
import { RedisGroupNotificationConsumer } from './RedisGroupNotificationConsumer'
import { RedisGroupNotificationPublisher } from './RedisGroupNotificationPublisher'
import type { RedisNotificationConfig } from './RedisNotificationFactory'

export function createGroupNotificationPair<T>(config: RedisNotificationConfig) {
  const serverUuid = randomUUID()
  if (config.publisherRedis === config.consumerRedis) {
    throw new Error(
      'Same Redis client instance cannot be used both for publisher and for consumer, please create a separate connection',
    )
  }

  const consumer = new RedisGroupNotificationConsumer<T>(config.consumerRedis, {
    channel: config.channel,
    serverUuid,
  })

  const publisher = new RedisGroupNotificationPublisher<T>(config.publisherRedis, {
    channel: config.channel,
    errorHandler: config.errorHandler,
    serverUuid,
  })

  return {
    publisher,
    consumer,
  }
}
