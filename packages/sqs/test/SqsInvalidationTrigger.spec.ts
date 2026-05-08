import { randomUUID } from 'node:crypto'
import { CreateQueueCommand, GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs'
import { CreateTopicCommand, PublishCommand } from '@aws-sdk/client-sns'
import { Loader, type InMemoryCacheConfiguration } from 'layered-loader'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createNotificationPair } from '../lib/SqsNotificationFactory.js'
import { SqsNotificationPublisher } from '../lib/SqsNotificationPublisher.js'
import { SqsInvalidationTrigger } from '../lib/triggers/SqsInvalidationTrigger.js'
import { type AwsClientBundle, buildAwsClients } from './fakes/awsClients.js'
import { buildConsumerDeps, buildPublisherDeps } from './fakes/dependencies.js'

const IN_MEMORY_CACHE_CONFIG = { ttlInMsecs: 99999 } satisfies InMemoryCacheConfiguration

class StubAsyncCache {
  public name = 'StubAsyncCache'
  constructor(private readonly value: string) {}
  get() {
    return Promise.resolve(this.value)
  }
  getMany(keys: string[]) {
    return Promise.resolve({ resolvedValues: keys.map(() => this.value), unresolvedKeys: [] })
  }
  set(): Promise<void> {
    return Promise.resolve()
  }
  delete(): Promise<void> {
    return Promise.resolve()
  }
  deleteMany(): Promise<void> {
    return Promise.resolve()
  }
  clear(): Promise<void> {
    return Promise.resolve()
  }
  close(): Promise<void> {
    return Promise.resolve()
  }
  getExpirationTime() {
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

const UPSTREAM_EVENT_SCHEMA = z.object({
  eventType: z.enum(['user.updated', 'user.deleted', 'user.bulk-updated', 'cache.flush']),
  userId: z.string().optional(),
  userIds: z.array(z.string()).optional(),
})
type UpstreamEvent = z.infer<typeof UPSTREAM_EVENT_SCHEMA>

describe('SqsInvalidationTrigger', () => {
  let clients: AwsClientBundle

  beforeAll(() => {
    const endpoint = process.env.FAUXQS_ENDPOINT
    if (!endpoint) throw new Error('FAUXQS_ENDPOINT is not set; globalSetup did not run')
    clients = buildAwsClients(endpoint)
  })

  afterAll(() => {
    clients.destroy()
  })

  describe('SNS topic source', () => {
    it('translates upstream events to fan-out invalidations across the cluster', async () => {
      const suffix = Math.random().toString(36).slice(2, 8)
      // 1. The application's own invalidation channel (the one peer caches subscribe to)
      const peerATopic = `app-invalidation-${suffix}`
      const peerAQueue1 = `app-invalidation-q1-${suffix}`
      const peerAQueue2 = `app-invalidation-q2-${suffix}`

      const peerA = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: peerATopic } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: peerATopic },
            queue: { QueueName: peerAQueue1 },
          },
        },
      })

      const peerB = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: peerATopic } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: peerATopic },
            queue: { QueueName: peerAQueue2 },
          },
        },
      })

      const loaderA = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: peerA.consumer,
        notificationPublisher: peerA.publisher,
      })
      const loaderB = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: peerB.consumer,
        notificationPublisher: peerB.publisher,
      })

      // 2. The upstream domain-event topic owned by some other service.
      const upstreamTopicName = `domain-events-${suffix}`
      const createTopic = await clients.snsClient.send(
        new CreateTopicCommand({ Name: upstreamTopicName }),
      )
      const upstreamTopicArn = createTopic.TopicArn!

      // The trigger needs its own publisher with a distinct serverUuid so that
      // every peer consumer — including the one running in this process —
      // treats trigger-emitted messages as foreign.
      const triggerPublisher = new SqsNotificationPublisher<string>({
        serverUuid: randomUUID(),
        dependencies: buildPublisherDeps(clients),
        locatorConfig: { topicName: peerATopic },
      })

      // 3. The trigger subscribes our fan-out queue to that upstream topic.
      const trigger = new SqsInvalidationTrigger<UpstreamEvent>({
        sourceType: 'sns-topic',
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: upstreamTopicName },
          queue: { QueueName: `trigger-q-${suffix}` },
        },
        messageSchema: UPSTREAM_EVENT_SCHEMA,
        publisher: triggerPublisher,
        resolver: (msg) => {
          switch (msg.eventType) {
            case 'user.updated':
            case 'user.deleted':
              return msg.userId ? { kind: 'delete', key: msg.userId } : null
            case 'user.bulk-updated':
              return msg.userIds && msg.userIds.length > 0
                ? { kind: 'deleteMany', keys: msg.userIds }
                : null
            case 'cache.flush':
              return { kind: 'clear' }
          }
        },
      })

      try {
        await loaderA.init()
        await loaderB.init()
        await trigger.start()

        await loaderA.getAsyncOnly('user-1')
        await loaderB.getAsyncOnly('user-1')
        expect(loaderA.getInMemoryOnly('user-1')).toBe('value')
        expect(loaderB.getInMemoryOnly('user-1')).toBe('value')

        // 4. External system publishes a domain event.
        await clients.snsClient.send(
          new PublishCommand({
            TopicArn: upstreamTopicArn,
            Message: JSON.stringify({ eventType: 'user.updated', userId: 'user-1' }),
          }),
        )

        await waitFor(
          () =>
            loaderA.getInMemoryOnly('user-1') === undefined &&
            loaderB.getInMemoryOnly('user-1') === undefined,
        )
        expect(loaderA.getInMemoryOnly('user-1')).toBeUndefined()
        expect(loaderB.getInMemoryOnly('user-1')).toBeUndefined()
      } finally {
        await Promise.allSettled([
          trigger.stop(),
          triggerPublisher.close(),
          peerA.consumer.close(),
          peerB.consumer.close(),
          peerA.publisher.close(),
          peerB.publisher.close(),
        ])
      }
    })

    it('handles bulk and clear actions', async () => {
      const suffix = Math.random().toString(36).slice(2, 8)
      const invalidationTopic = `bulk-clear-${suffix}`

      const peer = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: invalidationTopic } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: invalidationTopic },
            queue: { QueueName: `bulk-clear-peer-q-${suffix}` },
          },
        },
      })

      const loader = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: peer.consumer,
        notificationPublisher: peer.publisher,
      })

      const upstreamTopicName = `domain-${suffix}`
      const createTopic = await clients.snsClient.send(
        new CreateTopicCommand({ Name: upstreamTopicName }),
      )
      const upstreamTopicArn = createTopic.TopicArn!

      const triggerPublisher = new SqsNotificationPublisher<string>({
        serverUuid: randomUUID(),
        dependencies: buildPublisherDeps(clients),
        locatorConfig: { topicName: invalidationTopic },
      })

      const trigger = new SqsInvalidationTrigger<UpstreamEvent>({
        sourceType: 'sns-topic',
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: upstreamTopicName },
          queue: { QueueName: `bulk-clear-trigger-q-${suffix}` },
        },
        messageSchema: UPSTREAM_EVENT_SCHEMA,
        publisher: triggerPublisher,
        resolver: (msg) => {
          if (msg.eventType === 'user.bulk-updated' && msg.userIds) {
            return { kind: 'deleteMany', keys: msg.userIds }
          }
          if (msg.eventType === 'cache.flush') {
            return { kind: 'clear' }
          }
          return null
        },
      })

      try {
        await loader.init()
        await trigger.start()

        await loader.getAsyncOnly('a')
        await loader.getAsyncOnly('b')
        expect(loader.getInMemoryOnly('a')).toBe('value')
        expect(loader.getInMemoryOnly('b')).toBe('value')

        await clients.snsClient.send(
          new PublishCommand({
            TopicArn: upstreamTopicArn,
            Message: JSON.stringify({ eventType: 'user.bulk-updated', userIds: ['a', 'b'] }),
          }),
        )

        await waitFor(
          () =>
            loader.getInMemoryOnly('a') === undefined &&
            loader.getInMemoryOnly('b') === undefined,
        )

        await loader.getAsyncOnly('c')
        expect(loader.getInMemoryOnly('c')).toBe('value')

        await clients.snsClient.send(
          new PublishCommand({
            TopicArn: upstreamTopicArn,
            Message: JSON.stringify({ eventType: 'cache.flush' }),
          }),
        )

        await waitFor(() => loader.getInMemoryOnly('c') === undefined)
        expect(loader.getInMemoryOnly('c')).toBeUndefined()
      } finally {
        await Promise.allSettled([
          trigger.stop(),
          triggerPublisher.close(),
          peer.consumer.close(),
          peer.publisher.close(),
        ])
      }
    })

    it('skips messages for which the resolver returns null', async () => {
      const suffix = Math.random().toString(36).slice(2, 8)
      const invalidationTopic = `skip-${suffix}`

      const peer = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: invalidationTopic } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: invalidationTopic },
            queue: { QueueName: `skip-peer-q-${suffix}` },
          },
        },
      })

      const loader = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: peer.consumer,
        notificationPublisher: peer.publisher,
      })

      const upstreamTopicName = `skip-domain-${suffix}`
      const createTopic = await clients.snsClient.send(
        new CreateTopicCommand({ Name: upstreamTopicName }),
      )
      const upstreamTopicArn = createTopic.TopicArn!

      const triggerPublisher = new SqsNotificationPublisher<string>({
        serverUuid: randomUUID(),
        dependencies: buildPublisherDeps(clients),
        locatorConfig: { topicName: invalidationTopic },
      })

      let resolverCalls = 0
      const trigger = new SqsInvalidationTrigger<UpstreamEvent>({
        sourceType: 'sns-topic',
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: upstreamTopicName },
          queue: { QueueName: `skip-trigger-q-${suffix}` },
        },
        messageSchema: UPSTREAM_EVENT_SCHEMA,
        publisher: triggerPublisher,
        resolver: () => {
          resolverCalls += 1
          return null
        },
      })

      try {
        await loader.init()
        await trigger.start()

        await loader.getAsyncOnly('user-9')
        expect(loader.getInMemoryOnly('user-9')).toBe('value')

        await clients.snsClient.send(
          new PublishCommand({
            TopicArn: upstreamTopicArn,
            Message: JSON.stringify({ eventType: 'user.updated', userId: 'user-9' }),
          }),
        )

        await waitFor(() => resolverCalls > 0)
        await new Promise((r) => setTimeout(r, 200))
        expect(loader.getInMemoryOnly('user-9')).toBe('value')
      } finally {
        await Promise.allSettled([
          trigger.stop(),
          triggerPublisher.close(),
          peer.consumer.close(),
          peer.publisher.close(),
        ])
      }
    })
  })

  describe('SQS queue source', () => {
    it('processes messages dropped directly into a pre-existing SQS queue', async () => {
      const suffix = Math.random().toString(36).slice(2, 8)
      const invalidationTopic = `queue-src-${suffix}`

      const peer = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: invalidationTopic } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: invalidationTopic },
            queue: { QueueName: `queue-src-peer-q-${suffix}` },
          },
        },
      })

      const loader = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: peer.consumer,
        notificationPublisher: peer.publisher,
      })

      // Pre-create the upstream queue without involving the trigger
      const upstreamQueueName = `domain-events-q-${suffix}`
      await clients.sqsClient.send(new CreateQueueCommand({ QueueName: upstreamQueueName }))
      const queueUrl = (
        await clients.sqsClient.send(new GetQueueUrlCommand({ QueueName: upstreamQueueName }))
      ).QueueUrl!

      const triggerPublisher = new SqsNotificationPublisher<string>({
        serverUuid: randomUUID(),
        dependencies: buildPublisherDeps(clients),
        locatorConfig: { topicName: invalidationTopic },
      })

      const trigger = new SqsInvalidationTrigger<UpstreamEvent>({
        sourceType: 'sqs-queue',
        dependencies: buildConsumerDeps(clients),
        locatorConfig: { queueUrl },
        messageSchema: UPSTREAM_EVENT_SCHEMA,
        publisher: triggerPublisher,
        resolver: (msg) =>
          msg.eventType === 'user.deleted' && msg.userId
            ? { kind: 'delete', key: msg.userId }
            : null,
      })

      try {
        await loader.init()
        await trigger.start()

        await loader.getAsyncOnly('user-42')
        expect(loader.getInMemoryOnly('user-42')).toBe('value')

        await clients.sqsClient.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify({ eventType: 'user.deleted', userId: 'user-42' }),
          }),
        )

        await waitFor(() => loader.getInMemoryOnly('user-42') === undefined)
        expect(loader.getInMemoryOnly('user-42')).toBeUndefined()
      } finally {
        await Promise.allSettled([
          trigger.stop(),
          triggerPublisher.close(),
          peer.consumer.close(),
          peer.publisher.close(),
        ])
      }
    })
  })

  describe('error handling', () => {
    it('invokes errorHandler when resolver throws', async () => {
      const suffix = Math.random().toString(36).slice(2, 8)
      const upstreamQueueName = `err-q-${suffix}`
      await clients.sqsClient.send(new CreateQueueCommand({ QueueName: upstreamQueueName }))
      const queueUrl = (
        await clients.sqsClient.send(new GetQueueUrlCommand({ QueueName: upstreamQueueName }))
      ).QueueUrl!

      const peer = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: `err-topic-${suffix}` } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: `err-topic-${suffix}` },
            queue: { QueueName: `err-peer-q-${suffix}` },
          },
        },
      })

      const errors: Array<{ err: Error; channel: string }> = []
      const trigger = new SqsInvalidationTrigger<UpstreamEvent>({
        sourceType: 'sqs-queue',
        dependencies: buildConsumerDeps(clients),
        locatorConfig: { queueUrl },
        messageSchema: UPSTREAM_EVENT_SCHEMA,
        publisher: peer.publisher,
        resolver: () => {
          throw new Error('boom')
        },
        errorHandler: (err, channel) => {
          errors.push({ err, channel })
        },
        channel: 'custom-trigger-channel',
      })

      try {
        await trigger.start()
        await clients.sqsClient.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify({ eventType: 'user.updated', userId: 'x' }),
          }),
        )

        await waitFor(() => errors.length > 0)
        expect(errors[0]!.err.message).toBe('boom')
        expect(errors[0]!.channel).toBe('custom-trigger-channel')
      } finally {
        await Promise.allSettled([trigger.stop(), peer.consumer.close(), peer.publisher.close()])
      }
    })
  })
})
