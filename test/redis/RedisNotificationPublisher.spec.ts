import { setTimeout } from 'node:timers/promises'
import Redis from 'ioredis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Loader } from '../../lib/Loader'
import type { InMemoryCacheConfiguration } from '../../lib/memory/InMemoryCache'
import { createNotificationPair } from '../../lib/redis/RedisNotificationFactory'
import { DummyCache } from '../fakes/DummyCache'
import { FakeThrowingRedis } from '../fakes/FakeThrowingRedis'
import { redisOptions } from '../fakes/TestRedisConfig'
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
      createNotificationPair<string>({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const { publisher: notificationPublisher2, consumer: notificationConsumer2 } =
      createNotificationPair<string>({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })
    const operation = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumer1,
      notificationPublisher: notificationPublisher1,
    })

    const operation2 = new Loader<string>({
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

  it('Propagates invalidation event to remote cache, works with redis config passed', async () => {
    const { publisher: notificationPublisher1, consumer: notificationConsumer1 } =
      createNotificationPair<string>({
        channel: CHANNEL_ID,
        consumerRedis: redisOptions,
        publisherRedis: redisOptions,
      })

    const { publisher: notificationPublisher2, consumer: notificationConsumer2 } =
      createNotificationPair<string>({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })
    const operation = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumer1,
      notificationPublisher: notificationPublisher1,
    })

    const operation2 = new Loader<string>({
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

  it('Propagates set event to remote cache', async () => {
    const { publisher: notificationPublisher1, consumer: notificationConsumer1 } =
      createNotificationPair<string>({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const { publisher: notificationPublisher2, consumer: notificationConsumer2 } =
      createNotificationPair<string>({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })
    const operation = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumer1,
      notificationPublisher: notificationPublisher1,
    })

    const operation2 = new Loader<string>({
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
    await operation.forceSetValue('key', 'value2')
    await operation.forceSetValue('key2', null)

    await waitAndRetry(
      () => {
        const resultPost1 = operation.getInMemoryOnly('key')
        const resultPost2 = operation2.getInMemoryOnly('key')
        const resultPostValue2 = operation2.getInMemoryOnly('key2')
        return resultPost1 === 'value2' && resultPost2 === 'value2' && resultPostValue2 === null
      },
      50,
      100,
    )

    const resultPost1 = operation.getInMemoryOnly('key')
    const resultPost2 = operation2.getInMemoryOnly('key')
    const resultPostValue2 = operation2.getInMemoryOnly('key2')

    expect(resultPre1).toBe('value')
    expect(resultPre2).toBe('value')

    expect(resultPost1).toBe('value2')
    expect(resultPost2).toBe('value2')
    expect(resultPostValue2).toBeNull()

    await notificationConsumer1.close()
    await notificationPublisher1.close()
  })

  it('Propagates bulk invalidation event to remote cache', async () => {
    const { publisher: notificationPublisher1, consumer: notificationConsumer1 } =
      createNotificationPair<string>({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const { publisher: notificationPublisher2, consumer: notificationConsumer2 } =
      createNotificationPair<string>({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })
    const operation = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumer1,
      notificationPublisher: notificationPublisher1,
    })

    const operation2 = new Loader<string>({
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
      createNotificationPair<string>({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const { publisher: notificationPublisher2, consumer: notificationConsumer2 } =
      createNotificationPair<string>({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const operation = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumer1,
      notificationPublisher: notificationPublisher1,
    })

    const operation2 = new Loader<string>({
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
      createNotificationPair<string>({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: new FakeThrowingRedis(),
        errorHandler: (_err, channel) => {
          expect(channel).toBe(CHANNEL_ID)
        },
      })

    const operation = new Loader<string>({
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
      createNotificationPair<string>({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: new FakeThrowingRedis(),
        errorHandler: (_err, channel) => {
          expect(channel).toBe(CHANNEL_ID)
        },
      })

    const operation = new Loader<string>({
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
      createNotificationPair<string>({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
        errorHandler: (err, channel) => {
          expect(err.message).toBe('Connection is closed.')
          expect(channel).toBe(CHANNEL_ID)
        },
      })

    const operation = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumer,
      notificationPublisher: notificationPublisher,
    })

    await operation.invalidateCacheFor('key')

    await setTimeout(1)
    await setTimeout(1)
  })

  it('Ignores unknown action IDs', async () => {
    const { publisher: notificationPublisher1, consumer: notificationConsumer1 } =
      createNotificationPair<string>({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const operation = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumer1,
      notificationPublisher: notificationPublisher1,
    })
    await operation.init()

    const resultPre = await operation.get('key')
    expect(resultPre).toBe('value')

    // Publish unknown action ID directly
    await redisPublisher.publish(
      CHANNEL_ID,
      JSON.stringify({
        actionId: 'UNKNOWN_ACTION',
        originUuid: 'different-uuid',
      }),
    )

    await setTimeout(50)

    // Cache should remain unchanged
    const resultPost = await operation.get('key')
    expect(resultPost).toBe('value')

    await notificationConsumer1.close()
    await notificationPublisher1.close()
  })

  it('Removes message listeners on close', async () => {
    const { publisher: notificationPublisher1, consumer: notificationConsumer1 } =
      createNotificationPair<string>({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const operation = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumer1,
      notificationPublisher: notificationPublisher1,
    })
    await operation.init()

    expect(redisConsumer.listenerCount('message')).toBeGreaterThan(0)

    await notificationConsumer1.close()
    await notificationPublisher1.close()

    expect(redisConsumer.listenerCount('message')).toBe(0)
  })

  it('Ignores messages from other channels on a shared consumer connection', async () => {
    const { publisher: notificationPublisherA, consumer: notificationConsumerA } =
      createNotificationPair<string>({
        channel: 'channel_a',
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const { publisher: notificationPublisherB, consumer: notificationConsumerB } =
      createNotificationPair<string>({
        channel: 'channel_b',
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const operationA = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumerA,
      notificationPublisher: notificationPublisherA,
    })
    const operationB = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumerB,
      notificationPublisher: notificationPublisherB,
    })
    await operationA.init()
    await operationB.init()

    await operationA.getAsyncOnly('key')
    await operationB.getAsyncOnly('key')
    expect(operationA.getInMemoryOnly('key')).toBe('value')
    expect(operationB.getInMemoryOnly('key')).toBe('value')

    // Publish a DELETE on channel_a only, from a foreign origin
    await redisPublisher.publish(
      'channel_a',
      JSON.stringify({
        actionId: 'DELETE',
        key: 'key',
        originUuid: 'different-uuid',
      }),
    )

    // consumer A must apply it...
    await waitAndRetry(() => operationA.getInMemoryOnly('key') === undefined, 50, 100)
    expect(operationA.getInMemoryOnly('key')).toBeUndefined()

    // ...but consumer B, sharing the same Redis connection on another channel, must not
    expect(operationB.getInMemoryOnly('key')).toBe('value')

    await notificationConsumerA.close()
    await notificationPublisherA.close()
  })

  it('Survives malformed messages', async () => {
    const { publisher: notificationPublisher1, consumer: notificationConsumer1 } =
      createNotificationPair<string>({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const operation = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyCache('value'),
      notificationConsumer: notificationConsumer1,
      notificationPublisher: notificationPublisher1,
    })
    await operation.init()

    const resultPre = await operation.get('key')
    expect(resultPre).toBe('value')

    // A non-JSON payload must not crash the consumer
    await redisPublisher.publish(CHANNEL_ID, 'this is not json')

    // A valid message afterwards must still be processed
    await redisPublisher.publish(
      CHANNEL_ID,
      JSON.stringify({
        actionId: 'DELETE',
        key: 'key',
        originUuid: 'different-uuid',
      }),
    )

    await waitAndRetry(() => operation.getInMemoryOnly('key') === undefined, 50, 100)
    expect(operation.getInMemoryOnly('key')).toBeUndefined()

    await notificationConsumer1.close()
    await notificationPublisher1.close()
  })

  it('Handles error by default', async () => {
    expect.assertions(1)
    const { publisher: notificationPublisher, consumer: notificationConsumer } =
      createNotificationPair<string>({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: new FakeThrowingRedis(),
      })

    const operation = new Loader<string>({
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

    await operation.close()
    await notificationConsumer.close()
    await notificationPublisher.close()
  })
})
