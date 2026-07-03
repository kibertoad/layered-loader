import { setTimeout } from 'node:timers/promises'
import Redis from 'ioredis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GroupLoader } from '../../lib/GroupLoader'
import type { InMemoryCacheConfiguration } from '../../lib/memory'
import { createGroupNotificationPair } from '../../lib/redis/RedisGroupNotificationFactory'
import { DummyGroupedCache } from '../fakes/DummyGroupedCache'
import { FakeThrowingRedis } from '../fakes/FakeThrowingRedis'
import { redisOptions } from '../fakes/TestRedisConfig'
import type { User } from '../types/testTypes'
import { waitAndRetry } from '../utils/waitUtils'

const IN_MEMORY_CACHE_CONFIG = { ttlInMsecs: 99999 } satisfies InMemoryCacheConfiguration
const CHANNEL_ID = 'test_channel'

const user1: User = {
  companyId: '1',
  userId: '1',
}

const user2: User = {
  companyId: '1',
  userId: '2',
}

const user3: User = {
  companyId: '2',
  userId: '3',
}

const userValues = {
  [user1.companyId]: {
    [user1.userId]: user1,
    [user2.userId]: user2,
  },
  [user3.companyId]: {
    [user3.userId]: user3,
  },
  group: {
    key: user1,
  },
}

describe('RedisGroupNotificationPublisher', () => {
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
      createGroupNotificationPair({
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
      createGroupNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const { publisher: notificationPublisher2, consumer: notificationConsumer2 } =
      createGroupNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })
    const operation = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
      notificationConsumer: notificationConsumer1,
      notificationPublisher: notificationPublisher1,
    })

    const operation2 = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
      notificationConsumer: notificationConsumer2,
      notificationPublisher: notificationPublisher2,
    })
    await operation.init()
    await operation2.init()

    await operation.getAsyncOnly('key', 'group')
    await operation2.getAsyncOnly('key', 'group')
    const resultPre1 = operation.getInMemoryOnly('key', 'group')
    const resultPre2 = operation2.getInMemoryOnly('key', 'group')
    await operation.invalidateCacheFor('key', 'group')

    await waitAndRetry(
      () => {
        const resultPost1 = operation.getInMemoryOnly('key', 'group')
        const resultPost2 = operation2.getInMemoryOnly('key', 'group')
        return resultPost1 === undefined && resultPost2 === undefined
      },
      50,
      100,
    )

    const resultPost1 = operation.getInMemoryOnly('key', 'group')
    const resultPost2 = operation2.getInMemoryOnly('key', 'group')

    expect(resultPre1).toEqual(user1)
    expect(resultPre2).toEqual(user1)

    expect(resultPost1).toBeUndefined()
    expect(resultPost2).toBeUndefined()

    await notificationConsumer1.close()
    await notificationPublisher1.close()
  })

  it('Propagates invalidation event to remote cache, works with redis config', async () => {
    const { publisher: notificationPublisher1, consumer: notificationConsumer1 } =
      createGroupNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisOptions,
        publisherRedis: redisOptions,
      })

    const { publisher: notificationPublisher2, consumer: notificationConsumer2 } =
      createGroupNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })
    const operation = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
      notificationConsumer: notificationConsumer1,
      notificationPublisher: notificationPublisher1,
    })

    const operation2 = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
      notificationConsumer: notificationConsumer2,
      notificationPublisher: notificationPublisher2,
    })
    await operation.init()
    await operation2.init()

    await operation.getAsyncOnly('key', 'group')
    await operation2.getAsyncOnly('key', 'group')
    const resultPre1 = operation.getInMemoryOnly('key', 'group')
    const resultPre2 = operation2.getInMemoryOnly('key', 'group')
    await operation.invalidateCacheFor('key', 'group')

    await waitAndRetry(
      () => {
        const resultPost1 = operation.getInMemoryOnly('key', 'group')
        const resultPost2 = operation2.getInMemoryOnly('key', 'group')
        return resultPost1 === undefined && resultPost2 === undefined
      },
      50,
      100,
    )

    const resultPost1 = operation.getInMemoryOnly('key', 'group')
    const resultPost2 = operation2.getInMemoryOnly('key', 'group')

    expect(resultPre1).toEqual(user1)
    expect(resultPre2).toEqual(user1)

    expect(resultPost1).toBeUndefined()
    expect(resultPost2).toBeUndefined()

    await notificationConsumer1.close()
    await notificationPublisher1.close()
  })

  it('Propagates delete group event to remote cache', async () => {
    const { publisher: notificationPublisher1, consumer: notificationConsumer1 } =
      createGroupNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const { publisher: notificationPublisher2, consumer: notificationConsumer2 } =
      createGroupNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })
    const operation = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
      notificationConsumer: notificationConsumer1,
      notificationPublisher: notificationPublisher1,
    })

    const operation2 = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
      notificationConsumer: notificationConsumer2,
      notificationPublisher: notificationPublisher2,
    })
    await operation.init()
    await operation2.init()

    await operation.getAsyncOnly('key', 'group')
    await operation2.getAsyncOnly('key', 'group')
    const resultPre1 = operation.getInMemoryOnly('key', 'group')
    const resultPre2 = operation2.getInMemoryOnly('key', 'group')
    await operation.invalidateCacheForGroup('group')

    await waitAndRetry(
      () => {
        const resultPost1 = operation.getInMemoryOnly('key', 'group')
        const resultPost2 = operation2.getInMemoryOnly('key', 'group')
        return resultPost1 === undefined && resultPost2 === undefined
      },
      50,
      100,
    )

    const resultPost1 = operation.getInMemoryOnly('key', 'group')
    const resultPost2 = operation2.getInMemoryOnly('key', 'group')

    expect(resultPre1).toEqual(user1)
    expect(resultPre2).toEqual(user1)

    expect(resultPost1).toBeUndefined()
    expect(resultPost2).toBeUndefined()

    await notificationConsumer1.close()
    await notificationPublisher1.close()
  })

  it('Propagates clear event to remote cache', async () => {
    const { publisher: notificationPublisher1, consumer: notificationConsumer1 } =
      createGroupNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const { publisher: notificationPublisher2, consumer: notificationConsumer2 } =
      createGroupNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const operation = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
      notificationConsumer: notificationConsumer1,
      notificationPublisher: notificationPublisher1,
    })

    const operation2 = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
      notificationConsumer: notificationConsumer2,
      notificationPublisher: notificationPublisher2,
    })

    await operation.init()
    await operation2.init()

    await operation.getAsyncOnly('key', 'group')
    await operation2.getAsyncOnly('key', 'group')
    const resultPre1 = operation.getInMemoryOnly('key', 'group')
    const resultPre2 = operation2.getInMemoryOnly('key', 'group')
    await operation.invalidateCache()

    await waitAndRetry(
      () => {
        const resultPost1 = operation.getInMemoryOnly('key', 'group')
        const resultPost2 = operation2.getInMemoryOnly('key', 'group')
        return resultPost1 === undefined && resultPost2 === undefined
      },
      50,
      100,
    )

    const resultPost1 = operation.getInMemoryOnly('key', 'group')
    const resultPost2 = operation2.getInMemoryOnly('key', 'group')

    expect(resultPre1).toEqual(user1)
    expect(resultPre2).toEqual(user1)

    expect(resultPost1).toBeUndefined()
    expect(resultPost2).toBeUndefined()
  })

  it('Handles error on clear', async () => {
    expect.assertions(1)
    const { publisher: notificationPublisher, consumer: notificationConsumer } =
      createGroupNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: new FakeThrowingRedis(),
        errorHandler: (_err, channel) => {
          expect(channel).toBe(CHANNEL_ID)
        },
      })

    const operation = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
      notificationConsumer: notificationConsumer,
      notificationPublisher: notificationPublisher,
    })

    await operation.invalidateCache()
  })

  it('Handles error on delete', async () => {
    expect.assertions(1)
    const { publisher: notificationPublisher, consumer: notificationConsumer } =
      createGroupNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: new FakeThrowingRedis(),
        errorHandler: (_err, channel) => {
          expect(channel).toBe(CHANNEL_ID)
        },
      })

    const operation = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
      notificationConsumer: notificationConsumer,
      notificationPublisher: notificationPublisher,
    })

    await operation.invalidateCacheFor('key', 'group')
  })

  it('Handles error on delete group', async () => {
    expect.assertions(1)
    const { publisher: notificationPublisher, consumer: notificationConsumer } =
      createGroupNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: new FakeThrowingRedis(),
        errorHandler: (_err, channel) => {
          expect(channel).toBe(CHANNEL_ID)
        },
      })

    const operation = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
      notificationConsumer: notificationConsumer,
      notificationPublisher: notificationPublisher,
    })

    await operation.invalidateCacheForGroup('group')
  })

  it('Ignores unknown action IDs', async () => {
    const { publisher: notificationPublisher1, consumer: notificationConsumer1 } =
      createGroupNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const operation = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
      notificationConsumer: notificationConsumer1,
      notificationPublisher: notificationPublisher1,
    })
    await operation.init()

    await operation.getAsyncOnly('key', 'group')
    const resultPre = operation.getInMemoryOnly('key', 'group')
    expect(resultPre).toEqual(user1)

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
    const resultPost = operation.getInMemoryOnly('key', 'group')
    expect(resultPost).toEqual(user1)

    await notificationConsumer1.close()
    await notificationPublisher1.close()
  })

  it('Survives malformed messages', async () => {
    const { publisher: notificationPublisher1, consumer: notificationConsumer1 } =
      createGroupNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const operation = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
      notificationConsumer: notificationConsumer1,
      notificationPublisher: notificationPublisher1,
    })
    await operation.init()

    await operation.getAsyncOnly('key', 'group')
    expect(operation.getInMemoryOnly('key', 'group')).toEqual(user1)

    // A non-JSON payload must not crash the consumer
    await redisPublisher.publish(CHANNEL_ID, 'this is not json')

    // A valid message afterwards must still be processed
    await redisPublisher.publish(
      CHANNEL_ID,
      JSON.stringify({
        actionId: 'DELETE_GROUP',
        group: 'group',
        originUuid: 'different-uuid',
      }),
    )

    await waitAndRetry(() => operation.getInMemoryOnly('key', 'group') === undefined, 50, 100)
    expect(operation.getInMemoryOnly('key', 'group')).toBeUndefined()

    await notificationConsumer1.close()
    await notificationPublisher1.close()
  })

  it('Ignores messages from other channels on a shared consumer connection', async () => {
    const { publisher: notificationPublisherA, consumer: notificationConsumerA } =
      createGroupNotificationPair({
        channel: 'channel_a',
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const { publisher: notificationPublisherB, consumer: notificationConsumerB } =
      createGroupNotificationPair({
        channel: 'channel_b',
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const operationA = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
      notificationConsumer: notificationConsumerA,
      notificationPublisher: notificationPublisherA,
    })
    const operationB = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
      notificationConsumer: notificationConsumerB,
      notificationPublisher: notificationPublisherB,
    })
    await operationA.init()
    await operationB.init()

    await operationA.getAsyncOnly('key', 'group')
    await operationB.getAsyncOnly('key', 'group')
    expect(operationA.getInMemoryOnly('key', 'group')).toEqual(user1)
    expect(operationB.getInMemoryOnly('key', 'group')).toEqual(user1)

    // Publish a DELETE_GROUP on channel_a only, from a foreign origin
    await redisPublisher.publish(
      'channel_a',
      JSON.stringify({
        actionId: 'DELETE_GROUP',
        group: 'group',
        originUuid: 'different-uuid',
      }),
    )

    // consumer A must apply it...
    await waitAndRetry(() => operationA.getInMemoryOnly('key', 'group') === undefined, 50, 100)
    expect(operationA.getInMemoryOnly('key', 'group')).toBeUndefined()

    // ...but consumer B, sharing the same Redis connection on another channel, must not
    expect(operationB.getInMemoryOnly('key', 'group')).toEqual(user1)

    await notificationConsumerA.close()
    await notificationPublisherA.close()
  })

  it('Removes message listeners on close', async () => {
    const { publisher: notificationPublisher1, consumer: notificationConsumer1 } =
      createGroupNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })

    const operation = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
      notificationConsumer: notificationConsumer1,
      notificationPublisher: notificationPublisher1,
    })
    await operation.init()

    expect(redisConsumer.listenerCount('message')).toBeGreaterThan(0)

    await notificationConsumer1.close()
    await notificationPublisher1.close()

    expect(redisConsumer.listenerCount('message')).toBe(0)
  })

  it('Handles error by default', async () => {
    expect.assertions(1)
    const { publisher: notificationPublisher, consumer: notificationConsumer } =
      createGroupNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: new FakeThrowingRedis(),
      })

    const operation = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
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

    await operation.invalidateCacheFor('key', 'group')

    await operation.close()
    await notificationConsumer.close()
    await notificationPublisher.close()
  })

  it('Handles connection error on delete', async () => {
    expect.assertions(1)
    const { publisher: notificationPublisher, consumer: notificationConsumer } =
      createGroupNotificationPair({
        channel: CHANNEL_ID,
        consumerRedis: redisConsumer,
        publisherRedis: redisPublisher,
      })
    await redisPublisher.quit()

    const operation = new GroupLoader({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new DummyGroupedCache(userValues),
      notificationConsumer: notificationConsumer,
      notificationPublisher: notificationPublisher,
      logger: {
        error: (err) => {
          expect(err).toBe(
            'Error while publishing notification to channel test_channel: Connection is closed.',
          )
        },
      },
    })

    await operation.invalidateCacheFor('key', 'group')

    await setTimeout(1)
    await setTimeout(1)

    await operation.close()
    await notificationConsumer.close()
    await notificationPublisher.close()
  })
})
