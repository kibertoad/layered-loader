/**
 * Redis entrypoint (`layered-loader/redis`).
 *
 * This is the only entrypoint whose exports can reach `ioredis`. Consumers that do not run
 * Redis should import from `layered-loader/core` instead.
 *
 * Everything exported here is also re-exported from the package root.
 */

export { RedisCache } from './lib/redis/RedisCache.js'
export { RedisGroupCache } from './lib/redis/RedisGroupCache.js'
export { createNotificationPair } from './lib/redis/RedisNotificationFactory.js'
export { createGroupNotificationPair } from './lib/redis/RedisGroupNotificationFactory.js'
export { enrichRedisConfig, enrichRedisConfigOptimizedForCloud } from './lib/redis/enrichRedisConfig.js'
export { RedisNotificationConsumer } from './lib/redis/RedisNotificationConsumer.js'
export { RedisNotificationPublisher } from './lib/redis/RedisNotificationPublisher.js'
export { RedisGroupNotificationConsumer } from './lib/redis/RedisGroupNotificationConsumer.js'
export { RedisGroupNotificationPublisher } from './lib/redis/RedisGroupNotificationPublisher.js'

export type { RedisNotificationConfig } from './lib/redis/RedisNotificationFactory.js'
export type { RedisPublisherConfig } from './lib/redis/RedisNotificationPublisher.js'
export type { RedisConsumerConfig } from './lib/redis/RedisNotificationConsumer.js'
export type { RedisCacheConfiguration } from './lib/redis/AbstractRedisCache.js'
export type { RedisGroupCacheConfiguration } from './lib/redis/RedisGroupCache.js'
// Named in the public signatures above (`RedisCache`'s constructor, `RedisNotificationConfig`), so
// they have to be reachable — the exports map blocks deep imports.
export type {
  RedisConnectionOptions,
  RedisLike,
  RedisReconnectOnError,
} from './lib/redis/RedisLike.js'
