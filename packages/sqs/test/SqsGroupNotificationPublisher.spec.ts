import { GroupLoader, type InMemoryCacheConfiguration } from 'layered-loader'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGroupNotificationPair } from '../lib/SqsGroupNotificationFactory.js'
import { type AwsClientBundle, buildAwsClients } from './fakes/awsClients.js'
import { buildConsumerDeps, buildPublisherDeps } from './fakes/dependencies.js'

const IN_MEMORY_CACHE_CONFIG = { ttlInMsecs: 99999 } satisfies InMemoryCacheConfiguration

class StubGroupedAsyncCache {
  public name = 'StubGroupedAsyncCache'
  constructor(private readonly value: string) {}
  getFromGroup() {
    return Promise.resolve(this.value)
  }
  getManyFromGroup(keys: string[]) {
    return Promise.resolve({ resolvedValues: keys.map(() => this.value), unresolvedKeys: [] })
  }
  setForGroup(): Promise<void> {
    return Promise.resolve()
  }
  deleteFromGroup(): Promise<void> {
    return Promise.resolve()
  }
  deleteGroup(): Promise<void> {
    return Promise.resolve()
  }
  clear(): Promise<void> {
    return Promise.resolve()
  }
  close(): Promise<void> {
    return Promise.resolve()
  }
  getExpirationTimeFromGroup() {
    return Promise.resolve(undefined)
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000, intervalMs = 50): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error('Timed out waiting for predicate')
}

describe('SqsGroupNotificationPublisher', () => {
  let clients: AwsClientBundle

  beforeAll(() => {
    const endpoint = process.env.FAUXQS_ENDPOINT
    if (!endpoint) throw new Error('FAUXQS_ENDPOINT is not set; globalSetup did not run')
    clients = buildAwsClients(endpoint)
  })

  afterAll(() => {
    clients.destroy()
  })

  it('propagates a deleteFromGroup event to all remote consumers', async () => {
    const suffix = Math.random().toString(36).slice(2, 8)
    const topicName = `g-delete-from-${suffix}`

    const pair1 = createGroupNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: topicName } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: topicName },
          queue: { QueueName: `g-delete-from-q1-${suffix}` },
        },
      },
    })

    const pair2 = createGroupNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: topicName } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: topicName },
          queue: { QueueName: `g-delete-from-q2-${suffix}` },
        },
      },
    })

    const loader1 = new GroupLoader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new StubGroupedAsyncCache('value'),
      notificationConsumer: pair1.consumer,
      notificationPublisher: pair1.publisher,
    })
    const loader2 = new GroupLoader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new StubGroupedAsyncCache('value'),
      notificationConsumer: pair2.consumer,
      notificationPublisher: pair2.publisher,
    })

    try {
      await loader1.init()
      await loader2.init()

      await loader1.getAsyncOnly('key', 'group1')
      await loader2.getAsyncOnly('key', 'group1')

      expect(loader1.getInMemoryOnly('key', 'group1')).toBe('value')
      expect(loader2.getInMemoryOnly('key', 'group1')).toBe('value')

      await loader1.invalidateCacheFor('key', 'group1')

      await waitFor(() => loader2.getInMemoryOnly('key', 'group1') === undefined)
      expect(loader2.getInMemoryOnly('key', 'group1')).toBeUndefined()
    } finally {
      await Promise.allSettled([
        pair1.consumer.close(),
        pair2.consumer.close(),
        pair1.publisher.close(),
        pair2.publisher.close(),
      ])
    }
  })

  it('propagates a deleteGroup event to all remote consumers', async () => {
    const suffix = Math.random().toString(36).slice(2, 8)
    const topicName = `g-delete-${suffix}`

    const pair1 = createGroupNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: topicName } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: topicName },
          queue: { QueueName: `g-delete-q1-${suffix}` },
        },
      },
    })

    const pair2 = createGroupNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: topicName } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: topicName },
          queue: { QueueName: `g-delete-q2-${suffix}` },
        },
      },
    })

    const loader1 = new GroupLoader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new StubGroupedAsyncCache('value'),
      notificationConsumer: pair1.consumer,
      notificationPublisher: pair1.publisher,
    })
    const loader2 = new GroupLoader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new StubGroupedAsyncCache('value'),
      notificationConsumer: pair2.consumer,
      notificationPublisher: pair2.publisher,
    })

    try {
      await loader1.init()
      await loader2.init()

      await loader1.getAsyncOnly('keyA', 'group1')
      await loader2.getAsyncOnly('keyA', 'group1')
      await loader2.getAsyncOnly('keyB', 'group1')

      await loader1.invalidateCacheForGroup('group1')

      await waitFor(
        () =>
          loader2.getInMemoryOnly('keyA', 'group1') === undefined &&
          loader2.getInMemoryOnly('keyB', 'group1') === undefined,
      )
      expect(loader2.getInMemoryOnly('keyA', 'group1')).toBeUndefined()
      expect(loader2.getInMemoryOnly('keyB', 'group1')).toBeUndefined()
    } finally {
      await Promise.allSettled([
        pair1.consumer.close(),
        pair2.consumer.close(),
        pair1.publisher.close(),
        pair2.publisher.close(),
      ])
    }
  })

  it('propagates a clear event to all remote consumers', async () => {
    const suffix = Math.random().toString(36).slice(2, 8)
    const topicName = `g-clear-${suffix}`

    const pair1 = createGroupNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: topicName } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: topicName },
          queue: { QueueName: `g-clear-q1-${suffix}` },
        },
      },
    })

    const pair2 = createGroupNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: topicName } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: topicName },
          queue: { QueueName: `g-clear-q2-${suffix}` },
        },
      },
    })

    const loader1 = new GroupLoader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new StubGroupedAsyncCache('value'),
      notificationConsumer: pair1.consumer,
      notificationPublisher: pair1.publisher,
    })
    const loader2 = new GroupLoader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new StubGroupedAsyncCache('value'),
      notificationConsumer: pair2.consumer,
      notificationPublisher: pair2.publisher,
    })

    try {
      await loader1.init()
      await loader2.init()

      await loader2.getAsyncOnly('keyA', 'groupA')
      await loader2.getAsyncOnly('keyB', 'groupB')

      await loader1.invalidateCache()

      await waitFor(
        () =>
          loader2.getInMemoryOnly('keyA', 'groupA') === undefined &&
          loader2.getInMemoryOnly('keyB', 'groupB') === undefined,
      )
      expect(loader2.getInMemoryOnly('keyA', 'groupA')).toBeUndefined()
      expect(loader2.getInMemoryOnly('keyB', 'groupB')).toBeUndefined()
    } finally {
      await Promise.allSettled([
        pair1.consumer.close(),
        pair2.consumer.close(),
        pair1.publisher.close(),
        pair2.publisher.close(),
      ])
    }
  })
})
