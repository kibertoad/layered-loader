import { CreateQueueCommand, GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs'
import { CreateTopicCommand, PublishCommand } from '@aws-sdk/client-sns'
import { Loader, type InMemoryCacheConfiguration } from 'layered-loader'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createNotificationPair } from '../lib/SqsNotificationFactory.js'
import { composeTriggers } from '../lib/triggers/AbstractSqsTrigger.js'
import { SnsTopicInvalidationTrigger } from '../lib/triggers/SnsTopicInvalidationTrigger.js'
import { SqsQueueInvalidationTrigger } from '../lib/triggers/SqsQueueInvalidationTrigger.js'
import { type AwsClientBundle, buildAwsClients } from './fakes/awsClients.js'
import { buildConsumerDeps, buildPublisherDeps } from './fakes/dependencies.js'
import { StubAsyncCache, waitFor } from './utils/testHelpers.js'

const IN_MEMORY_CACHE_CONFIG = { ttlInMsecs: 99999 } satisfies InMemoryCacheConfiguration

const UPSTREAM_EVENT_SCHEMA = z.object({
  eventType: z.enum(['user.updated', 'user.deleted', 'user.bulk-updated', 'cache.flush']),
  userId: z.string().optional(),
  userIds: z.array(z.string()).optional(),
})
type UpstreamEvent = z.infer<typeof UPSTREAM_EVENT_SCHEMA>

describe('SnsTopicInvalidationTrigger', () => {
  let clients: AwsClientBundle

  beforeAll(() => {
    const endpoint = process.env.FAUXQS_ENDPOINT
    if (!endpoint) throw new Error('FAUXQS_ENDPOINT is not set; globalSetup did not run')
    clients = buildAwsClients(endpoint)
  })

  afterAll(() => {
    clients.destroy()
  })

  it('translates upstream events to fan-out invalidations across the cluster', async () => {
    const suffix = Math.random().toString(36).slice(2, 8)
    const peerTopic = `app-invalidation-${suffix}`

    const peerA = createNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: peerTopic } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: peerTopic },
          queue: { QueueName: `app-invalidation-q1-${suffix}` },
        },
      },
    })

    const peerB = createNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: peerTopic } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: peerTopic },
          queue: { QueueName: `app-invalidation-q2-${suffix}` },
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

    const upstreamTopicName = `domain-events-${suffix}`
    const createTopic = await clients.snsClient.send(
      new CreateTopicCommand({ Name: upstreamTopicName }),
    )
    const upstreamTopicArn = createTopic.TopicArn!

    const trigger = new SnsTopicInvalidationTrigger({
      target: loaderA,
      dependencies: buildConsumerDeps(clients),
      sources: [
        {
          creationConfig: {
            topic: { Name: upstreamTopicName },
            queue: { QueueName: `trigger-q-${suffix}` },
          },
          bindings: [
            {
              messageSchema: UPSTREAM_EVENT_SCHEMA,
              resolver: (msg: UpstreamEvent) => {
                switch (msg.eventType) {
                  case 'user.updated':
                  case 'user.deleted':
                    return msg.userId ? { kind: 'delete', key: msg.userId } : null
                  case 'user.bulk-updated':
                    return msg.userIds?.length
                      ? { kind: 'deleteMany', keys: msg.userIds }
                      : null
                  case 'cache.flush':
                    return { kind: 'clear' }
                }
              },
            },
          ],
        },
      ],
    })

    try {
      await loaderA.init()
      await loaderB.init()
      await trigger.start()

      await loaderA.getAsyncOnly('user-1')
      await loaderB.getAsyncOnly('user-1')
      expect(loaderA.getInMemoryOnly('user-1')).toBe('value')
      expect(loaderB.getInMemoryOnly('user-1')).toBe('value')

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
    } finally {
      await Promise.allSettled([
        trigger.stop(),
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

    const trigger = new SnsTopicInvalidationTrigger({
      target: loader,
      dependencies: buildConsumerDeps(clients),
      sources: [
        {
          creationConfig: {
            topic: { Name: upstreamTopicName },
            queue: { QueueName: `bulk-clear-trigger-q-${suffix}` },
          },
          bindings: [
            {
              messageSchema: UPSTREAM_EVENT_SCHEMA,
              resolver: (msg: UpstreamEvent) => {
                if (msg.eventType === 'user.bulk-updated' && msg.userIds) {
                  return { kind: 'deleteMany', keys: msg.userIds }
                }
                if (msg.eventType === 'cache.flush') {
                  return { kind: 'clear' }
                }
                return null
              },
            },
          ],
        },
      ],
    })

    try {
      await loader.init()
      await trigger.start()

      await loader.getAsyncOnly('a')
      await loader.getAsyncOnly('b')

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
      await clients.snsClient.send(
        new PublishCommand({
          TopicArn: upstreamTopicArn,
          Message: JSON.stringify({ eventType: 'cache.flush' }),
        }),
      )

      await waitFor(() => loader.getInMemoryOnly('c') === undefined)
    } finally {
      await Promise.allSettled([trigger.stop(), peer.consumer.close(), peer.publisher.close()])
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

    let resolverCalls = 0
    const trigger = new SnsTopicInvalidationTrigger({
      target: loader,
      dependencies: buildConsumerDeps(clients),
      sources: [
        {
          creationConfig: {
            topic: { Name: upstreamTopicName },
            queue: { QueueName: `skip-trigger-q-${suffix}` },
          },
          bindings: [
            {
              messageSchema: UPSTREAM_EVENT_SCHEMA,
              resolver: () => {
                resolverCalls += 1
                return null
              },
            },
          ],
        },
      ],
    })

    try {
      await loader.init()
      await trigger.start()

      await loader.getAsyncOnly('user-9')

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
      await Promise.allSettled([trigger.stop(), peer.consumer.close(), peer.publisher.close()])
    }
  })

  it('subscribes to multiple SNS topics with one dependency block', async () => {
    const suffix = Math.random().toString(36).slice(2, 8)
    const invalidationTopic = `multi-sns-${suffix}`

    const peer = createNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: invalidationTopic } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: invalidationTopic },
          queue: { QueueName: `multi-sns-peer-q-${suffix}` },
        },
      },
    })

    const loader = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new StubAsyncCache('value'),
      notificationConsumer: peer.consumer,
      notificationPublisher: peer.publisher,
    })

    const topicAName = `multi-src-a-${suffix}`
    const topicBName = `multi-src-b-${suffix}`
    const topicA = (await clients.snsClient.send(new CreateTopicCommand({ Name: topicAName })))
      .TopicArn!
    const topicB = (await clients.snsClient.send(new CreateTopicCommand({ Name: topicBName })))
      .TopicArn!

    const trigger = new SnsTopicInvalidationTrigger({
      target: loader,
      dependencies: buildConsumerDeps(clients),
      sources: [
        {
          creationConfig: {
            topic: { Name: topicAName },
            queue: { QueueName: `multi-sns-trigger-a-${suffix}` },
          },
          bindings: [
            {
              messageSchema: UPSTREAM_EVENT_SCHEMA,
              resolver: (m: UpstreamEvent) =>
                m.userId ? { kind: 'delete', key: m.userId } : null,
            },
          ],
        },
        {
          creationConfig: {
            topic: { Name: topicBName },
            queue: { QueueName: `multi-sns-trigger-b-${suffix}` },
          },
          bindings: [
            {
              messageSchema: UPSTREAM_EVENT_SCHEMA,
              resolver: (m: UpstreamEvent) =>
                m.userIds?.length ? { kind: 'deleteMany', keys: m.userIds } : null,
            },
          ],
        },
      ],
    })

    try {
      await loader.init()
      await trigger.start()

      await loader.getAsyncOnly('x')
      await loader.getAsyncOnly('y')
      await loader.getAsyncOnly('z')

      await clients.snsClient.send(
        new PublishCommand({
          TopicArn: topicA,
          Message: JSON.stringify({ eventType: 'user.updated', userId: 'x' }),
        }),
      )
      await clients.snsClient.send(
        new PublishCommand({
          TopicArn: topicB,
          Message: JSON.stringify({ eventType: 'user.bulk-updated', userIds: ['y', 'z'] }),
        }),
      )

      await waitFor(
        () =>
          loader.getInMemoryOnly('x') === undefined &&
          loader.getInMemoryOnly('y') === undefined &&
          loader.getInMemoryOnly('z') === undefined,
      )
    } finally {
      await Promise.allSettled([trigger.stop(), peer.consumer.close(), peer.publisher.close()])
    }
  })

  it('routes different event types from the same topic to different resolvers', async () => {
    const suffix = Math.random().toString(36).slice(2, 8)
    const invalidationTopic = `routed-sns-${suffix}`

    const peer = createNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: invalidationTopic } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: invalidationTopic },
          queue: { QueueName: `routed-sns-peer-q-${suffix}` },
        },
      },
    })

    const loader = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new StubAsyncCache('value'),
      notificationConsumer: peer.consumer,
      notificationPublisher: peer.publisher,
    })

    const upstreamTopicName = `routed-sns-domain-${suffix}`
    const upstreamTopicArn = (
      await clients.snsClient.send(new CreateTopicCommand({ Name: upstreamTopicName }))
    ).TopicArn!

    const USER_UPDATED = z.object({ type: z.literal('user.updated'), userId: z.string() })
    const USER_BULK = z.object({ type: z.literal('user.bulk'), userIds: z.array(z.string()) })

    let userUpdatedCalls = 0
    let userBulkCalls = 0

    const trigger = new SnsTopicInvalidationTrigger({
      target: loader,
      dependencies: buildConsumerDeps(clients),
      sources: [
        {
          creationConfig: {
            topic: { Name: upstreamTopicName },
            queue: { QueueName: `routed-sns-trigger-q-${suffix}` },
          },
          messageTypeField: 'type',
          bindings: [
            {
              messageType: 'user.updated',
              messageSchema: USER_UPDATED,
              resolver: (m: z.infer<typeof USER_UPDATED>) => {
                userUpdatedCalls += 1
                return { kind: 'delete', key: m.userId }
              },
            },
            {
              messageType: 'user.bulk',
              messageSchema: USER_BULK,
              resolver: (m: z.infer<typeof USER_BULK>) => {
                userBulkCalls += 1
                return { kind: 'deleteMany', keys: m.userIds }
              },
            },
          ],
        },
      ],
    })

    try {
      await loader.init()
      await trigger.start()

      await loader.getAsyncOnly('p')
      await loader.getAsyncOnly('q')
      await loader.getAsyncOnly('r')

      await clients.snsClient.send(
        new PublishCommand({
          TopicArn: upstreamTopicArn,
          Message: JSON.stringify({ type: 'user.updated', userId: 'p' }),
        }),
      )
      await clients.snsClient.send(
        new PublishCommand({
          TopicArn: upstreamTopicArn,
          Message: JSON.stringify({ type: 'user.bulk', userIds: ['q', 'r'] }),
        }),
      )

      await waitFor(
        () =>
          loader.getInMemoryOnly('p') === undefined &&
          loader.getInMemoryOnly('q') === undefined &&
          loader.getInMemoryOnly('r') === undefined,
      )
      expect(userUpdatedCalls).toBe(1)
      expect(userBulkCalls).toBe(1)
    } finally {
      await Promise.allSettled([trigger.stop(), peer.consumer.close(), peer.publisher.close()])
    }
  })

  it('routes every member of a single union-schema binding and drops events outside it', async () => {
    const suffix = Math.random().toString(36).slice(2, 8)
    const invalidationTopic = `union-sns-${suffix}`

    const peer = createNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: invalidationTopic } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: invalidationTopic },
          queue: { QueueName: `union-sns-peer-q-${suffix}` },
        },
      },
    })

    const loader = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new StubAsyncCache('value'),
      notificationConsumer: peer.consumer,
      notificationPublisher: peer.publisher,
    })

    const upstreamTopicName = `union-sns-domain-${suffix}`
    const upstreamTopicArn = (
      await clients.snsClient.send(new CreateTopicCommand({ Name: upstreamTopicName }))
    ).TopicArn!

    // A single binding whose schema is a z.union of two event types — the
    // flexible-trigger analogue of binding one consumer to a union of two
    // message-queue-toolkit consumerSchemas. Because there is exactly one
    // binding and no messageTypeField, every message routes to this handler and
    // is validated against the union; events matching neither member are
    // rejected before the resolver runs.
    const LANGUAGE_ADDED = z.object({
      type: z.literal('project_language.added'),
      key: z.string(),
    })
    const LANGUAGE_REMOVED = z.object({
      type: z.literal('project_language.removed'),
      key: z.string(),
    })
    const PROJECT_LANGUAGE_EVENT_SCHEMA = z.union([LANGUAGE_ADDED, LANGUAGE_REMOVED])

    let addedCalls = 0
    let removedCalls = 0

    const trigger = new SnsTopicInvalidationTrigger({
      target: loader,
      dependencies: buildConsumerDeps(clients),
      sources: [
        {
          creationConfig: {
            topic: { Name: upstreamTopicName },
            queue: { QueueName: `union-sns-trigger-q-${suffix}` },
          },
          bindings: [
            {
              messageSchema: PROJECT_LANGUAGE_EVENT_SCHEMA,
              resolver: (msg: z.infer<typeof PROJECT_LANGUAGE_EVENT_SCHEMA>) => {
                if (msg.type === 'project_language.added') {
                  addedCalls += 1
                  return { kind: 'delete', key: msg.key }
                }
                if (msg.type === 'project_language.removed') {
                  removedCalls += 1
                  return { kind: 'delete', key: msg.key }
                }
                return null
              },
            },
          ],
        },
      ],
    })

    try {
      await loader.init()
      await trigger.start()

      await loader.getAsyncOnly('lang-a')
      await loader.getAsyncOnly('lang-b')
      await loader.getAsyncOnly('lang-c')

      // Both union members get routed...
      await clients.snsClient.send(
        new PublishCommand({
          TopicArn: upstreamTopicArn,
          Message: JSON.stringify({ type: 'project_language.added', key: 'lang-a' }),
        }),
      )
      await clients.snsClient.send(
        new PublishCommand({
          TopicArn: upstreamTopicArn,
          Message: JSON.stringify({ type: 'project_language.removed', key: 'lang-b' }),
        }),
      )
      // ...while an event type that is NOT part of the union is dropped: it
      // fails union validation and never reaches the resolver.
      await clients.snsClient.send(
        new PublishCommand({
          TopicArn: upstreamTopicArn,
          Message: JSON.stringify({ type: 'project_language.renamed', key: 'lang-c' }),
        }),
      )

      await waitFor(
        () =>
          loader.getInMemoryOnly('lang-a') === undefined &&
          loader.getInMemoryOnly('lang-b') === undefined,
      )
      // Give the excluded event the same window the routed ones had, then assert
      // it was never processed: resolver counts stay at one apiece and its entry
      // is untouched.
      await new Promise((r) => setTimeout(r, 200))

      expect(addedCalls).toBe(1)
      expect(removedCalls).toBe(1)
      expect(loader.getInMemoryOnly('lang-c')).toBe('value')
    } finally {
      await Promise.allSettled([trigger.stop(), peer.consumer.close(), peer.publisher.close()])
    }
  })
})

describe('SqsQueueInvalidationTrigger', () => {
  let clients: AwsClientBundle

  beforeAll(() => {
    const endpoint = process.env.FAUXQS_ENDPOINT
    if (!endpoint) throw new Error('FAUXQS_ENDPOINT is not set; globalSetup did not run')
    clients = buildAwsClients(endpoint)
  })

  afterAll(() => {
    clients.destroy()
  })

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

    const upstreamQueueName = `domain-events-q-${suffix}`
    await clients.sqsClient.send(new CreateQueueCommand({ QueueName: upstreamQueueName }))
    const queueUrl = (
      await clients.sqsClient.send(new GetQueueUrlCommand({ QueueName: upstreamQueueName }))
    ).QueueUrl!

    const trigger = new SqsQueueInvalidationTrigger({
      target: loader,
      dependencies: buildConsumerDeps(clients),
      sources: [
        {
          locatorConfig: { queueUrl },
          bindings: [
            {
              messageSchema: UPSTREAM_EVENT_SCHEMA,
              resolver: (m: UpstreamEvent) =>
                m.eventType === 'user.deleted' && m.userId
                  ? { kind: 'delete', key: m.userId }
                  : null,
            },
          ],
        },
      ],
    })

    try {
      await loader.init()
      await trigger.start()

      await loader.getAsyncOnly('user-42')
      await clients.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({ eventType: 'user.deleted', userId: 'user-42' }),
        }),
      )

      await waitFor(() => loader.getInMemoryOnly('user-42') === undefined)
    } finally {
      await Promise.allSettled([trigger.stop(), peer.consumer.close(), peer.publisher.close()])
    }
  })

  it('consumes from two SQS queues simultaneously', async () => {
    const suffix = Math.random().toString(36).slice(2, 8)
    const invalidationTopic = `multi-sqs-${suffix}`

    const peer = createNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: invalidationTopic } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: invalidationTopic },
          queue: { QueueName: `multi-sqs-peer-q-${suffix}` },
        },
      },
    })

    const loader = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new StubAsyncCache('value'),
      notificationConsumer: peer.consumer,
      notificationPublisher: peer.publisher,
    })

    const queueA = `multi-sqs-a-${suffix}`
    const queueB = `multi-sqs-b-${suffix}`
    await clients.sqsClient.send(new CreateQueueCommand({ QueueName: queueA }))
    await clients.sqsClient.send(new CreateQueueCommand({ QueueName: queueB }))
    const queueAUrl = (await clients.sqsClient.send(new GetQueueUrlCommand({ QueueName: queueA })))
      .QueueUrl!
    const queueBUrl = (await clients.sqsClient.send(new GetQueueUrlCommand({ QueueName: queueB })))
      .QueueUrl!

    const trigger = new SqsQueueInvalidationTrigger({
      target: loader,
      dependencies: buildConsumerDeps(clients),
      sources: [
        {
          locatorConfig: { queueUrl: queueAUrl },
          bindings: [
            {
              messageSchema: UPSTREAM_EVENT_SCHEMA,
              resolver: (m: UpstreamEvent) =>
                m.userId ? { kind: 'delete', key: m.userId } : null,
            },
          ],
        },
        {
          locatorConfig: { queueUrl: queueBUrl },
          bindings: [
            {
              messageSchema: UPSTREAM_EVENT_SCHEMA,
              resolver: (m: UpstreamEvent) =>
                m.userIds?.length ? { kind: 'deleteMany', keys: m.userIds } : null,
            },
          ],
        },
      ],
    })

    try {
      await loader.init()
      await trigger.start()

      await loader.getAsyncOnly('x')
      await loader.getAsyncOnly('y')
      await loader.getAsyncOnly('z')

      await clients.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueAUrl,
          MessageBody: JSON.stringify({ eventType: 'user.updated', userId: 'x' }),
        }),
      )
      await clients.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueBUrl,
          MessageBody: JSON.stringify({ eventType: 'user.bulk-updated', userIds: ['y', 'z'] }),
        }),
      )

      await waitFor(
        () =>
          loader.getInMemoryOnly('x') === undefined &&
          loader.getInMemoryOnly('y') === undefined &&
          loader.getInMemoryOnly('z') === undefined,
      )
    } finally {
      await Promise.allSettled([trigger.stop(), peer.consumer.close(), peer.publisher.close()])
    }
  })

  it('routes different event types on the same queue to different resolvers', async () => {
    const suffix = Math.random().toString(36).slice(2, 8)
    const invalidationTopic = `routed-sqs-${suffix}`

    const peer = createNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: invalidationTopic } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: invalidationTopic },
          queue: { QueueName: `routed-sqs-peer-q-${suffix}` },
        },
      },
    })

    const loader = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new StubAsyncCache('value'),
      notificationConsumer: peer.consumer,
      notificationPublisher: peer.publisher,
    })

    const upstreamQueueName = `routed-sqs-src-${suffix}`
    await clients.sqsClient.send(new CreateQueueCommand({ QueueName: upstreamQueueName }))
    const queueUrl = (
      await clients.sqsClient.send(new GetQueueUrlCommand({ QueueName: upstreamQueueName }))
    ).QueueUrl!

    const USER_UPDATED = z.object({ type: z.literal('user.updated'), userId: z.string() })
    const USER_BULK = z.object({ type: z.literal('user.bulk'), userIds: z.array(z.string()) })

    let userUpdatedCalls = 0
    let userBulkCalls = 0

    const trigger = new SqsQueueInvalidationTrigger({
      target: loader,
      dependencies: buildConsumerDeps(clients),
      sources: [
        {
          locatorConfig: { queueUrl },
          messageTypeField: 'type',
          bindings: [
            {
              messageType: 'user.updated',
              messageSchema: USER_UPDATED,
              resolver: (m: z.infer<typeof USER_UPDATED>) => {
                userUpdatedCalls += 1
                return { kind: 'delete', key: m.userId }
              },
            },
            {
              messageType: 'user.bulk',
              messageSchema: USER_BULK,
              resolver: (m: z.infer<typeof USER_BULK>) => {
                userBulkCalls += 1
                return { kind: 'deleteMany', keys: m.userIds }
              },
            },
          ],
        },
      ],
    })

    try {
      await loader.init()
      await trigger.start()

      await loader.getAsyncOnly('p')
      await loader.getAsyncOnly('q')
      await loader.getAsyncOnly('r')

      await clients.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({ type: 'user.updated', userId: 'p' }),
        }),
      )
      await clients.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({ type: 'user.bulk', userIds: ['q', 'r'] }),
        }),
      )

      await waitFor(
        () =>
          loader.getInMemoryOnly('p') === undefined &&
          loader.getInMemoryOnly('q') === undefined &&
          loader.getInMemoryOnly('r') === undefined,
      )
      expect(userUpdatedCalls).toBe(1)
      expect(userBulkCalls).toBe(1)
    } finally {
      await Promise.allSettled([trigger.stop(), peer.consumer.close(), peer.publisher.close()])
    }
  })

  it('start and stop are idempotent and safe to call concurrently', async () => {
    const suffix = Math.random().toString(36).slice(2, 8)
    const upstreamQueueName = `lifecycle-q-${suffix}`
    await clients.sqsClient.send(new CreateQueueCommand({ QueueName: upstreamQueueName }))
    const queueUrl = (
      await clients.sqsClient.send(new GetQueueUrlCommand({ QueueName: upstreamQueueName }))
    ).QueueUrl!

    const peer = createNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: `lifecycle-topic-${suffix}` } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: `lifecycle-topic-${suffix}` },
          queue: { QueueName: `lifecycle-peer-q-${suffix}` },
        },
      },
    })

    const loader = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new StubAsyncCache('value'),
      notificationConsumer: peer.consumer,
      notificationPublisher: peer.publisher,
    })

    const trigger = new SqsQueueInvalidationTrigger({
      target: loader,
      dependencies: buildConsumerDeps(clients),
      sources: [
        {
          locatorConfig: { queueUrl },
          bindings: [{ messageSchema: UPSTREAM_EVENT_SCHEMA, resolver: () => null }],
        },
      ],
    })

    try {
      await Promise.all([trigger.start(), trigger.start(), trigger.start()])
      await trigger.start()
      await trigger.stop()
      await trigger.stop()
      await trigger.start()
    } finally {
      await Promise.allSettled([trigger.stop(), peer.consumer.close(), peer.publisher.close()])
    }
  })

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

    const loader = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new StubAsyncCache('value'),
      notificationConsumer: peer.consumer,
      notificationPublisher: peer.publisher,
    })

    const errors: Array<{ err: Error; channel: string }> = []
    const trigger = new SqsQueueInvalidationTrigger({
      target: loader,
      dependencies: buildConsumerDeps(clients),
      sources: [
        {
          locatorConfig: { queueUrl },
          bindings: [
            {
              messageSchema: UPSTREAM_EVENT_SCHEMA,
              resolver: () => {
                throw new Error('boom')
              },
            },
          ],
        },
      ],
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

describe('composeTriggers', () => {
  let clients: AwsClientBundle

  beforeAll(() => {
    const endpoint = process.env.FAUXQS_ENDPOINT
    if (!endpoint) throw new Error('FAUXQS_ENDPOINT is not set; globalSetup did not run')
    clients = buildAwsClients(endpoint)
  })

  afterAll(() => {
    clients.destroy()
  })

  it('manages an SQS-queue trigger and an SNS-topic trigger as a single unit', async () => {
    const suffix = Math.random().toString(36).slice(2, 8)
    const invalidationTopic = `compose-${suffix}`

    const peer = createNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: invalidationTopic } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: invalidationTopic },
          queue: { QueueName: `compose-peer-q-${suffix}` },
        },
      },
    })

    const loader = new Loader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new StubAsyncCache('value'),
      notificationConsumer: peer.consumer,
      notificationPublisher: peer.publisher,
    })

    const upstreamTopicName = `compose-domain-${suffix}`
    const upstreamTopicArn = (
      await clients.snsClient.send(new CreateTopicCommand({ Name: upstreamTopicName }))
    ).TopicArn!

    const upstreamQueueName = `compose-queue-${suffix}`
    await clients.sqsClient.send(new CreateQueueCommand({ QueueName: upstreamQueueName }))
    const queueUrl = (
      await clients.sqsClient.send(new GetQueueUrlCommand({ QueueName: upstreamQueueName }))
    ).QueueUrl!

    const snsTrigger = new SnsTopicInvalidationTrigger({
      target: loader,
      dependencies: buildConsumerDeps(clients),
      sources: [
        {
          creationConfig: {
            topic: { Name: upstreamTopicName },
            queue: { QueueName: `compose-trigger-sns-q-${suffix}` },
          },
          bindings: [
            {
              messageSchema: UPSTREAM_EVENT_SCHEMA,
              resolver: (m: UpstreamEvent) =>
                m.userId ? { kind: 'delete', key: m.userId } : null,
            },
          ],
        },
      ],
    })

    const sqsTrigger = new SqsQueueInvalidationTrigger({
      target: loader,
      dependencies: buildConsumerDeps(clients),
      sources: [
        {
          locatorConfig: { queueUrl },
          bindings: [
            {
              messageSchema: UPSTREAM_EVENT_SCHEMA,
              resolver: (m: UpstreamEvent) =>
                m.userIds?.length ? { kind: 'deleteMany', keys: m.userIds } : null,
            },
          ],
        },
      ],
    })

    const composite = composeTriggers(snsTrigger, sqsTrigger)

    try {
      await loader.init()
      await composite.start()

      await loader.getAsyncOnly('alice')
      await loader.getAsyncOnly('bob')
      await loader.getAsyncOnly('carol')

      await clients.snsClient.send(
        new PublishCommand({
          TopicArn: upstreamTopicArn,
          Message: JSON.stringify({ eventType: 'user.updated', userId: 'alice' }),
        }),
      )
      await clients.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({
            eventType: 'user.bulk-updated',
            userIds: ['bob', 'carol'],
          }),
        }),
      )

      await waitFor(
        () =>
          loader.getInMemoryOnly('alice') === undefined &&
          loader.getInMemoryOnly('bob') === undefined &&
          loader.getInMemoryOnly('carol') === undefined,
      )
    } finally {
      await Promise.allSettled([composite.stop(), peer.consumer.close(), peer.publisher.close()])
    }
  })
})
