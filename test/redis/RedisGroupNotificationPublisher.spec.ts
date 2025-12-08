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
