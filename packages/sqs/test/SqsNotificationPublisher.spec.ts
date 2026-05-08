import { Loader, type InMemoryCacheConfiguration } from 'layered-loader'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createNotificationPair } from '../lib/SqsNotificationFactory.js'
import { type AwsClientBundle, buildAwsClients } from './fakes/awsClients.js'
import { buildConsumerDeps, buildPublisherDeps } from './fakes/dependencies.js'
import { StubAsyncCache, waitFor } from './utils/testHelpers.js'

const IN_MEMORY_CACHE_CONFIG = { ttlInMsecs: 99999 } satisfies InMemoryCacheConfiguration

describe('SqsNotificationPublisher', () => {
  let clients: AwsClientBundle

  beforeAll(() => {
    const endpoint = process.env.FAUXQS_ENDPOINT
    if (!endpoint) throw new Error('FAUXQS_ENDPOINT is not set; globalSetup did not run')
    clients = buildAwsClients(endpoint)
  })

  afterAll(() => {
    clients.destroy()
  })

  describe('with auto-created topic and queue', () => {
    let suffix: string

    beforeEach(() => {
      suffix = Math.random().toString(36).slice(2, 8)
    })

    it('propagates a delete event to a remote consumer', async () => {
      const { publisher: publisher1, consumer: consumer1 } = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: `delete-test-${suffix}` } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: `delete-test-${suffix}` },
            queue: { QueueName: `delete-test-q1-${suffix}` },
          },
        },
      })

      const { publisher: publisher2, consumer: consumer2 } = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: `delete-test-${suffix}` } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: `delete-test-${suffix}` },
            queue: { QueueName: `delete-test-q2-${suffix}` },
          },
        },
      })

      const loader1 = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: consumer1,
        notificationPublisher: publisher1,
      })
      const loader2 = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: consumer2,
        notificationPublisher: publisher2,
      })

      try {
        await loader1.init()
        await loader2.init()

        await loader1.getAsyncOnly('key')
        await loader2.getAsyncOnly('key')

        expect(loader1.getInMemoryOnly('key')).toBe('value')
        expect(loader2.getInMemoryOnly('key')).toBe('value')

        await loader1.invalidateCacheFor('key')

        await waitFor(() => loader2.getInMemoryOnly('key') === undefined)
        expect(loader2.getInMemoryOnly('key')).toBeUndefined()
      } finally {
        await Promise.allSettled([
          consumer1.close(),
          consumer2.close(),
          publisher1.close(),
          publisher2.close(),
        ])
      }
    })

    it('propagates a clear event to all remote consumers', async () => {
      const { publisher: publisher1, consumer: consumer1 } = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: `clear-test-${suffix}` } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: `clear-test-${suffix}` },
            queue: { QueueName: `clear-test-q1-${suffix}` },
          },
        },
      })

      const { publisher: publisher2, consumer: consumer2 } = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: `clear-test-${suffix}` } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: `clear-test-${suffix}` },
            queue: { QueueName: `clear-test-q2-${suffix}` },
          },
        },
      })

      const loader1 = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: consumer1,
        notificationPublisher: publisher1,
      })
      const loader2 = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: consumer2,
        notificationPublisher: publisher2,
      })

      try {
        await loader1.init()
        await loader2.init()

        await loader1.getAsyncOnly('key')
        await loader2.getAsyncOnly('key')

        await loader1.invalidateCache()

        await waitFor(() => loader2.getInMemoryOnly('key') === undefined)
        expect(loader2.getInMemoryOnly('key')).toBeUndefined()
      } finally {
        await Promise.allSettled([
          consumer1.close(),
          consumer2.close(),
          publisher1.close(),
          publisher2.close(),
        ])
      }
    })

    it('propagates a deleteMany event to remote consumers', async () => {
      const { publisher: publisher1, consumer: consumer1 } = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: `delmany-test-${suffix}` } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: `delmany-test-${suffix}` },
            queue: { QueueName: `delmany-test-q1-${suffix}` },
          },
        },
      })

      const { publisher: publisher2, consumer: consumer2 } = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: `delmany-test-${suffix}` } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: `delmany-test-${suffix}` },
            queue: { QueueName: `delmany-test-q2-${suffix}` },
          },
        },
      })

      const loader1 = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: consumer1,
        notificationPublisher: publisher1,
      })
      const loader2 = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: consumer2,
        notificationPublisher: publisher2,
      })

      try {
        await loader1.init()
        await loader2.init()

        await loader1.getAsyncOnly('keyA')
        await loader1.getAsyncOnly('keyB')
        await loader2.getAsyncOnly('keyA')
        await loader2.getAsyncOnly('keyB')

        await loader1.invalidateCacheForMany(['keyA', 'keyB'])

        await waitFor(
          () =>
            loader2.getInMemoryOnly('keyA') === undefined &&
            loader2.getInMemoryOnly('keyB') === undefined,
        )
        expect(loader2.getInMemoryOnly('keyA')).toBeUndefined()
        expect(loader2.getInMemoryOnly('keyB')).toBeUndefined()
      } finally {
        await Promise.allSettled([
          consumer1.close(),
          consumer2.close(),
          publisher1.close(),
          publisher2.close(),
        ])
      }
    })
  })

  describe('with locatorConfig (existing topic/queue/subscription)', () => {
    it('reuses already-provisioned topic, queue and subscription', async () => {
      const suffix = Math.random().toString(36).slice(2, 8)
      const topicName = `locator-topic-${suffix}`
      const queueName = `locator-queue-${suffix}`

      // Provision topic, queue and subscription via creationConfig and capture identifiers
      const provisioner = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: topicName } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: topicName },
            queue: { QueueName: queueName },
          },
        },
      })

      // The flat (non-grouped) consumer is normally bootstrapped via Loader.init,
      // which calls setTargetCache before subscribe. For one-off provisioning we
      // set a no-op cache to satisfy that contract.
      provisioner.consumer.setTargetCache({
        get: () => undefined,
        getMany: () => ({ resolvedValues: [], unresolvedKeys: [] }),
        set: () => undefined,
        delete: () => undefined,
        deleteMany: () => undefined,
        clear: () => undefined,
        getExpirationTime: () => undefined,
      })
      await provisioner.publisher.subscribe()
      await provisioner.consumer.subscribe()
      const topicArn = provisioner.publisher.topicArn
      const subscriptionArn = provisioner.consumer.subscriptionArn
      const queueUrl = provisioner.consumer.queueUrl
      await provisioner.publisher.close()
      await provisioner.consumer.close()

      expect(topicArn).toBeTruthy()
      expect(subscriptionArn).toBeTruthy()
      expect(queueUrl).toBeTruthy()

      const { publisher, consumer } = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          locatorConfig: { topicArn },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          locatorConfig: { topicArn, queueUrl, subscriptionArn },
        },
      })

      const loader = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: consumer,
        notificationPublisher: publisher,
      })

      try {
        await loader.init()

        await loader.getAsyncOnly('key')
        expect(loader.getInMemoryOnly('key')).toBe('value')

        await loader.invalidateCacheFor('key')
        await new Promise((r) => setTimeout(r, 200))
        expect(loader.getInMemoryOnly('key')).toBeUndefined()
      } finally {
        await Promise.allSettled([consumer.close(), publisher.close()])
      }
    })
  })

  describe('error handling', () => {
    it('rejects publish when topic does not exist and no creationConfig is given', async () => {
      const { publisher } = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          locatorConfig: { topicName: 'definitely-does-not-exist-xyz' },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: 'unrelated' },
            queue: { QueueName: 'unrelated-q' },
          },
        },
      })

      try {
        await expect(publisher.delete('key')).rejects.toBeDefined()
      } finally {
        await publisher.close().catch(() => undefined)
      }
    })

    it('exposes channel name derived from creation config', () => {
      const { publisher, consumer } = createNotificationPair<string>({
        channel: 'custom-channel',
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: 'irrelevant' } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: 'irrelevant' },
            queue: { QueueName: 'irrelevant-q' },
          },
        },
      })
      expect(publisher.channel).toBe('custom-channel')
      expect(consumer.serverUuid).toBeTruthy()
    })

    it('falls back to topic name when channel is not provided', () => {
      const { publisher } = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: 'derived-channel' } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: 'derived-channel' },
            queue: { QueueName: 'derived-q' },
          },
        },
      })
      expect(publisher.channel).toBe('derived-channel')
    })
  })

  describe('serverUuid filtering', () => {
    it('skips messages emitted by the same process', async () => {
      const suffix = Math.random().toString(36).slice(2, 8)
      const { publisher, consumer } = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: `self-test-${suffix}` } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: `self-test-${suffix}` },
            queue: { QueueName: `self-test-q-${suffix}` },
          },
        },
      })

      const loader = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: consumer,
        notificationPublisher: publisher,
      })

      try {
        await loader.init()

        await loader.getAsyncOnly('key')
        expect(loader.getInMemoryOnly('key')).toBe('value')

        await loader.invalidateCacheFor('key')

        // Self-publish means the cache stays cleared locally (cleared synchronously by Loader),
        // and the message bouncing back via SQS must not re-affect the cache.
        await new Promise((r) => setTimeout(r, 200))
        expect(loader.getInMemoryOnly('key')).toBeUndefined()

        // Re-populate; the consumer must not undo this with a stale self-message.
        await loader.getAsyncOnly('key')
        await new Promise((r) => setTimeout(r, 200))
        expect(loader.getInMemoryOnly('key')).toBe('value')
      } finally {
        await Promise.allSettled([consumer.close(), publisher.close()])
      }
    })
  })
})
