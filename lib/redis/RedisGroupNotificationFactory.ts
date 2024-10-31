import { randomUUID } from 'node:crypto'
import { RedisGroupNotificationConsumer } from './RedisGroupNotificationConsumer'
import { RedisGroupNotificationPublisher } from './RedisGroupNotificationPublisher'
import {isClient, RedisNotificationConfig} from './RedisNotificationFactory'
import {Redis} from "ioredis";

export function createGroupNotificationPair<T>(config: RedisNotificationConfig) {
  const resolvedConsumer = isClient(config.consumerRedis) ? config.consumerRedis : new Redis(config.consumerRedis)
  const resolvedPublisher = isClient(config.publisherRedis) ? config.publisherRedis : new Redis(config.publisherRedis)

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
