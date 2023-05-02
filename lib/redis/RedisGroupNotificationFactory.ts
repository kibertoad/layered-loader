import { randomUUID } from 'node:crypto'
import type { RedisNotificationConfig } from './RedisNotificationFactory'
import { RedisGroupNotificationPublisher } from './RedisGroupNotificationPublisher'
import { RedisGroupNotificationConsumer } from './RedisGroupNotificationConsumer'

export function createGroupNotificationPair(config: RedisNotificationConfig) {
  const serverUuid = randomUUID()
  if (config.publisherRedis === config.consumerRedis) {
    throw new Error(
      'Same Redis client instance cannot be used both for publisher and for consumer, please create a separate connection'
    )
  }

  const consumer = new RedisGroupNotificationConsumer(config.consumerRedis, {
    channel: config.channel,
    serverUuid,
  })

  const publisher = new RedisGroupNotificationPublisher(config.publisherRedis, {
    channel: config.channel,
    errorHandler: config.errorHandler,
    serverUuid,
  })

  return {
    publisher,
    consumer,
  }
}
