/**
 * Redis-free entrypoint (`layered-loader/core`).
 *
 * Nothing reachable from this file imports `ioredis` at runtime, so it is safe to use in
 * environments where Redis is not part of the infrastructure, or where a Node-only client
 * cannot be bundled at all (Cloudflare Workers and other edge runtimes).
 *
 * Everything exported here is also re-exported from the package root.
 */

export { Loader } from './lib/Loader.js'
export { GroupLoader } from './lib/GroupLoader.js'
export { ManualCache } from './lib/ManualCache.js'
export { ManualGroupCache } from './lib/ManualGroupCache.js'
export { AbstractNotificationConsumer } from './lib/notifications/AbstractNotificationConsumer.js'
export { DEFAULT_FROM_STRING_RESOLVER, DEFAULT_FROM_ID_RESOLVER } from './lib/AbstractCache.js'

export type {
  NotificationPublisher,
  PublisherErrorHandler,
} from './lib/notifications/NotificationPublisher.js'
export type { GroupNotificationPublisher } from './lib/notifications/GroupNotificationPublisher.js'
export type { ConsumerErrorHandler } from './lib/notifications/AbstractNotificationConsumer.js'
export type {
  SynchronousCache,
  SynchronousGroupCache,
  SynchronousWriteCache,
  SynchronousWriteGroupCache,
  GetManyResult,
} from './lib/types/SyncDataSources.js'
export type { InMemoryCache, InMemoryCacheConfiguration } from './lib/memory/InMemoryCache.js'
export type {
  InMemoryGroupCache,
  InMemoryGroupCacheConfiguration,
} from './lib/memory/InMemoryGroupCache.js'
export type { LoaderConfig } from './lib/Loader.js'
export type { CommonCacheConfig, CacheKeyResolver, IdHolder } from './lib/AbstractCache.js'
export type { GroupLoaderConfig } from './lib/GroupLoader.js'
export type { ManualGroupCacheConfig } from './lib/ManualGroupCache.js'
export type {
  DataSource,
  GroupDataSource,
  Cache,
  CommonCacheConfiguration,
  IsEntryStillCurrentFn,
  IsGroupEntryStillCurrentFn,
} from './lib/types/DataSources.js'
export type {
  BackgroundWorkMeta,
  BackgroundWorkReason,
  BackgroundWorkScheduler,
} from './lib/types/BackgroundWork.js'
export type { Logger, LogFn } from './lib/util/Logger.js'

export { HitStatisticsRecord } from 'toad-cache'
