import Redis from 'ioredis'
import { setTimeout } from 'timers/promises'
import { Loader } from '../../lib/Loader'
import type { InMemoryCacheConfiguration } from '../../lib/memory/InMemoryCache'
import { redisOptions } from '../fakes/TestRedisConfig'

import { createNotificationPair } from '../../lib/redis/RedisNotificationFactory'
import { DummyCache } from '../fakes/DummyCache'
import { FakeThrowingRedis } from '../fakes/FakeThrowingRedis'
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

  it('throws an error if same Redis instance is used for both pub and sub', () => {
    expect(() =>
      createNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisConsumer,
      }),
    ).toThrow(
      /Same Redis client instance cannot be used both for publisher and for consumer, please create a separate connection/,
    )
  })

  it('Propagates invalidation event to remote cache', async () => {
    const { publisher: notificationPublisher1, consumer: notificationConsumer1 } =
      createNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const { publisher: notificationPublisher2, consumer: notificationConsumer2 } =
      createNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })
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
    await operation.init()
    await operation2.init()

    await operation.getAsyncOnly('key')
    await operation2.getAsyncOnly('key')
    const resultPre1 = operation.getInMemoryOnly('key')
    const resultPre2 = operation2.getInMemoryOnly('key')
    await operation.invalidateCacheFor('key')

    await waitAndRetry(
      () => {
        const resultPost1 = operation.getInMemoryOnly('key')
        const resultPost2 = operation2.getInMemoryOnly('key')
        return resultPost1 === undefined && resultPost2 === undefined
      },
      50,
      100,
    )

    const resultPost1 = operation.getInMemoryOnly('key')
    const resultPost2 = operation2.getInMemoryOnly('key')

    expect(resultPre1).toBe('value')
    expect(resultPre2).toBe('value')

    expect(resultPost1).toBeUndefined()
    expect(resultPost2).toBeUndefined()

    await notificationConsumer1.close()
    await notificationPublisher1.close()
  })

  it('Propagates bulk invalidation event to remote cache', async () => {
    const { publisher: notificationPublisher1, consumer: notificationConsumer1 } =
      createNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const { publisher: notificationPublisher2, consumer: notificationConsumer2 } =
      createNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })
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
    await operation.init()
    await operation2.init()

    await operation.getAsyncOnly('key')
    await operation2.getAsyncOnly('key')
    const resultPre1 = operation.getInMemoryOnly('key')
    const resultPre2 = operation2.getInMemoryOnly('key')
    await operation.invalidateCacheForMany(['key2', 'key'])

    await waitAndRetry(
      () => {
        const resultPost1 = operation.getInMemoryOnly('key')
        const resultPost2 = operation2.getInMemoryOnly('key')
        return resultPost1 === undefined && resultPost2 === undefined
      },
      50,
      100,
    )

    const resultPost1 = operation.getInMemoryOnly('key')
    const resultPost2 = operation2.getInMemoryOnly('key')

    expect(resultPre1).toBe('value')
    expect(resultPre2).toBe('value')

    expect(resultPost1).toBeUndefined()
    expect(resultPost2).toBeUndefined()

    await notificationConsumer1.close()
    await notificationPublisher1.close()
  })

  it('Propagates clear event to remote cache', async () => {
    const { publisher: notificationPublisher1, consumer: notificationConsumer1 } =
      createNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const { publisher: notificationPublisher2, consumer: notificationConsumer2 } =
      createNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

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

    await operation.init()
    await operation2.init()

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
      100,
    )

    const resultPost1 = operation.getInMemoryOnly('key')
    const resultPost2 = operation2.getInMemoryOnly('key')

    expect(resultPre1).toBe('value')
    expect(resultPre2).toBe('value')

    expect(resultPost1).toBeUndefined()
    expect(resultPost2).toBeUndefined()
  })

  it('Handles error on clear', async () => {
    expect.assertions(1)
    const { publisher: notificationPublisher, consumer: notificationConsumer } =
      createNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: new FakeThrowingRedis(),
        errorHandler: (err, channel) => {
          expect(channel).toBe(CHANNEL_ID)
        },
      })

    const operation = new Loader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumer,
      notificationPublisher: notificationPublisher,
    })

    await operation.invalidateCache()
  })

  it('Handles error on delete', async () => {
    expect.assertions(1)
    const { publisher: notificationPublisher, consumer: notificationConsumer } =
      createNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: new FakeThrowingRedis(),
        errorHandler: (err, channel) => {
          expect(channel).toBe(CHANNEL_ID)
        },
      })

    const operation = new Loader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumer,
      notificationPublisher: notificationPublisher,
    })

    await operation.invalidateCacheFor('key')
  })

  it('Handles connection error on delete', async () => {
    expect.assertions(2)
    await redisPublisher.quit()
    const { publisher: notificationPublisher, consumer: notificationConsumer } =
      createNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
        errorHandler: (err, channel) => {
          expect(err.message).toBe('Connection is closed.')
          expect(channel).toBe(CHANNEL_ID)
        },
      })

    const operation = new Loader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumer,
      notificationPublisher: notificationPublisher,
    })

    await operation.invalidateCacheFor('key')

    await setTimeout(1)
    await setTimeout(1)
  })

  it('Handles error by default', async () => {
    expect.assertions(1)
    const { publisher: notificationPublisher, consumer: notificationConsumer } =
      createNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: new FakeThrowingRedis(),
      })

    const operation = new Loader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumer,
      notificationPublisher: notificationPublisher,
      logger: {
        error: (err) => {
          expect(err).toBe(
            'Error while publishing notification to channel test_channel: Operation has failed',
          )
        },
      },
    })

    await operation.invalidateCacheFor('key')
  })
})
