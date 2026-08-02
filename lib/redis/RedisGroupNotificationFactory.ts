import { randomUUID } from 'node:crypto'
import { RedisGroupNotificationConsumer } from './RedisGroupNotificationConsumer.js'
import { RedisGroupNotificationPublisher } from './RedisGroupNotificationPublisher.js'
import type { RedisNotificationConfig } from './RedisNotificationFactory.js'
import { resolveRedisClient } from './resolveRedisClient.js'

export function createGroupNotificationPair<T>(config: RedisNotificationConfig) {
  const resolvedConsumer = resolveRedisClient(config.consumerRedis)
  const resolvedPublisher = resolveRedisClient(config.publisherRedis)

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
