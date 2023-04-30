import Redis from 'ioredis'
import { redisOptions } from '../fakes/TestRedisConfig'
import { RedisNotificationConsumer } from '../../lib/redis/RedisNotificationConsumer'
import { RedisNotificationPublisher } from '../../lib/redis/RedisNotificationPublisher'
import { Loader } from '../../lib/Loader'
import type { InMemoryCacheConfiguration } from '../../lib/memory'
import { DummyCache } from '../fakes/DummyCache'
import { setTimeout } from 'timers/promises'
import { waitAndRetry } from '../utils/waitUtils'

const IN_MEMORY_CACHE_CONFIG = { ttlInMsecs: 99999 } satisfies InMemoryCacheConfiguration
const CHANNEL_ID = 'test_channel'

describe('RedisNotificationPublisher', () => {
  let redisPublisher: Redis
  let redisConsumer: Redis
  beforeEach(async () => {
    redisPublisher = new Redis(redisOptions)
    redisConsumer = new Redis(redisOptions)
    await redisPublisher.flushall()
    await redisConsumer.flushall()
  })
  afterEach(async () => {
    await redisPublisher.disconnect()
    await redisConsumer.disconnect()
  })

  it('Propagates invalidation event to remote cache', async () => {
    const notificationConsumer1 = new RedisNotificationConsumer(redisConsumer, { channel: CHANNEL_ID })
    const notificationConsumer2 = new RedisNotificationConsumer(redisConsumer, { channel: CHANNEL_ID })
    const notificationPublisher1 = new RedisNotificationPublisher(redisPublisher, { channel: CHANNEL_ID })
    const notificationPublisher2 = new RedisNotificationPublisher(redisPublisher, { channel: CHANNEL_ID })

    const operation = new Loader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumer1,
      notificationPublisher: notificationPublisher1,
    })

    const operation2 = new Loader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumer2,
      notificationPublisher: notificationPublisher2,
    })

    await operation.getAsyncOnly('key')
    await operation2.getAsyncOnly('key')
    const resultPre1 = operation.getInMemoryOnly('key')
    const resultPre2 = operation2.getInMemoryOnly('key')
    await operation.invalidateCacheFor('key')
    await setTimeout(50)
    const resultPost1 = operation.getInMemoryOnly('key')
    const resultPost2 = operation2.getInMemoryOnly('key')

    expect(resultPre1).toBe('value')
    expect(resultPre2).toBe('value')

    await waitAndRetry(
      () => {
        const resultPost1 = operation.getInMemoryOnly('key')
        const resultPost2 = operation2.getInMemoryOnly('key')
        return resultPost1 === undefined && resultPost2 === undefined
      },
      50,
      100
    )

    expect(resultPost1).toBeUndefined()
    expect(resultPost2).toBeUndefined()

    await notificationConsumer1.close()
    await notificationPublisher1.close()
  })

  it('Propagates clear event to remote cache', async () => {
    const notificationConsumer1 = new RedisNotificationConsumer(redisConsumer, { channel: CHANNEL_ID })
    const notificationConsumer2 = new RedisNotificationConsumer(redisConsumer, { channel: CHANNEL_ID })
    const notificationPublisher1 = new RedisNotificationPublisher(redisPublisher, { channel: CHANNEL_ID })
    const notificationPublisher2 = new RedisNotificationPublisher(redisPublisher, { channel: CHANNEL_ID })

    const operation = new Loader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumer1,
      notificationPublisher: notificationPublisher1,
    })

    const operation2 = new Loader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumer2,
      notificationPublisher: notificationPublisher2,
    })

    await operation.getAsyncOnly('key')
    await operation2.getAsyncOnly('key')
    const resultPre1 = operation.getInMemoryOnly('key')
    const resultPre2 = operation2.getInMemoryOnly('key')
    await operation.invalidateCache()

    await waitAndRetry(
      () => {
        const resultPost1 = operation.getInMemoryOnly('key')
        const resultPost2 = operation2.getInMemoryOnly('key')
        return resultPost1 === undefined && resultPost2 === undefined
      },
      50,
      100
    )

    const resultPost1 = operation.getInMemoryOnly('key')
    const resultPost2 = operation2.getInMemoryOnly('key')

    expect(resultPre1).toBe('value')
    expect(resultPre2).toBe('value')

    expect(resultPost1).toBeUndefined()
    expect(resultPost2).toBeUndefined()
  })
})
