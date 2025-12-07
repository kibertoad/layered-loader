import { setTimeout } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Loader } from '../../lib/Loader'
import type { InMemoryCacheConfiguration } from '../../lib/memory/InMemoryCache'
import type { RedisClientType } from '../../lib/redis/RedisClientAdapter'
import { createNotificationPair } from '../../lib/redis/RedisNotificationFactory'
import { DummyCache } from '../fakes/DummyCache'
import { FakeThrowingRedis } from '../fakes/FakeThrowingRedis'
import { testServerConfigs } from '../fakes/TestRedisConfig'
import { waitAndRetry } from '../utils/waitUtils'

const IN_MEMORY_CACHE_CONFIG = { ttlInMsecs: 99999 } satisfies InMemoryCacheConfiguration
const CHANNEL_ID = 'test_channel'

describe.each(testServerConfigs)(
  'RedisNotificationPublisher ($name)',
  ({ options, createPubSubPair, closePubSubPair }) => {
    let redisPublisher: RedisClientType
    let redisConsumer: RedisClientType

    async function setupPubSubClients() {
      const pair = await createPubSubPair(CHANNEL_ID)
      redisPublisher = pair.publisher
      redisConsumer = pair.consumer
      await redisPublisher.flushall()
      await redisConsumer.flushall()
    }

    beforeEach(async () => {
      await setupPubSubClients()
    })

    afterEach(async () => {
      await closePubSubPair({ publisher: redisPublisher, consumer: redisConsumer })
    })

    it('throws an error if same Redis instance is used for both pub and sub', async () => {
      await expect(
        createNotificationPair({
          channel: CHANNEL_ID,
          consumerRedis: redisConsumer,
          publisherRedis: redisConsumer,
        }),
      ).rejects.toThrow(
        /Same Redis client instance cannot be used both for publisher and for consumer, please create a separate connection/,
      )
    })

    it('Propagates invalidation event to remote cache', async () => {
      const { publisher: notificationPublisher1, consumer: notificationConsumer1 } =
        await createNotificationPair<string>({
          channel: CHANNEL_ID,
          consumerRedis: redisConsumer,
          publisherRedis: redisPublisher,
        })

      const { publisher: notificationPublisher2, consumer: notificationConsumer2 } =
        await createNotificationPair<string>({
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
        await createNotificationPair<string>({
          channel: CHANNEL_ID,
          consumerRedis: options,
          publisherRedis: options,
        })

      const { publisher: notificationPublisher2, consumer: notificationConsumer2 } =
        await createNotificationPair<string>({
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
        await createNotificationPair<string>({
          channel: CHANNEL_ID,
          consumerRedis: redisConsumer,
          publisherRedis: redisPublisher,
        })

      const { publisher: notificationPublisher2, consumer: notificationConsumer2 } =
        await createNotificationPair<string>({
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
        await createNotificationPair<string>({
          channel: CHANNEL_ID,
          consumerRedis: redisConsumer,
          publisherRedis: redisPublisher,
        })

      const { publisher: notificationPublisher2, consumer: notificationConsumer2 } =
        await createNotificationPair<string>({
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
        await createNotificationPair<string>({
          channel: CHANNEL_ID,
          consumerRedis: redisConsumer,
          publisherRedis: redisPublisher,
        })

      const { publisher: notificationPublisher2, consumer: notificationConsumer2 } =
        await createNotificationPair<string>({
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
        await createNotificationPair<string>({
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
        await createNotificationPair<string>({
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
      // Close the publisher connection to simulate connection error
      if ('quit' in redisPublisher && typeof redisPublisher.quit === 'function') {
        await redisPublisher.quit()
      } else if ('close' in redisPublisher && typeof redisPublisher.close === 'function') {
        await redisPublisher.close()
      }

      const { publisher: notificationPublisher, consumer: notificationConsumer } =
        await createNotificationPair<string>({
          channel: CHANNEL_ID,
          consumerRedis: redisConsumer,
          publisherRedis: redisPublisher,
          errorHandler: (err, channel) => {
            expect(err.message).toContain('closed')
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

    it('Handles error by default', async () => {
      expect.assertions(1)
      const { publisher: notificationPublisher, consumer: notificationConsumer } =
        await createNotificationPair<string>({
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
    })
  },
)
