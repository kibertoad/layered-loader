import { CreateTopicCommand, PublishCommand } from '@aws-sdk/client-sns'
import { CreateQueueCommand, GetQueueUrlCommand, SendMessageCommand } from '@aws-sdk/client-sqs'
import { GroupLoader, type InMemoryCacheConfiguration } from 'layered-loader'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createGroupNotificationPair } from '../lib/SqsGroupNotificationFactory.js'
import { SnsTopicGroupInvalidationTrigger } from '../lib/triggers/SnsTopicGroupInvalidationTrigger.js'
import { SqsQueueGroupInvalidationTrigger } from '../lib/triggers/SqsQueueGroupInvalidationTrigger.js'
import { type AwsClientBundle, buildAwsClients } from './fakes/awsClients.js'
import { buildConsumerDeps, buildPublisherDeps } from './fakes/dependencies.js'
import { StubGroupedAsyncCache, waitFor } from './utils/testHelpers.js'

const IN_MEMORY_CACHE_CONFIG = { ttlInMsecs: 99999 } satisfies InMemoryCacheConfiguration

const TENANT_EVENT_SCHEMA = z.object({
  type: z.enum(['tenant.user.updated', 'tenant.purged']),
  tenantId: z.string(),
  userId: z.string().optional(),
})
type TenantEvent = z.infer<typeof TENANT_EVENT_SCHEMA>

describe('SnsTopicGroupInvalidationTrigger', () => {
  let clients: AwsClientBundle

  beforeAll(() => {
    const endpoint = process.env.FAUXQS_ENDPOINT
    if (!endpoint) throw new Error('FAUXQS_ENDPOINT is not set; globalSetup did not run')
    clients = buildAwsClients(endpoint)
  })

  afterAll(() => {
    clients.destroy()
  })

  it('translates tenant events into per-group invalidation across the cluster', async () => {
    const suffix = Math.random().toString(36).slice(2, 8)
    const invalidationTopic = `group-trigger-${suffix}`

    const peer = createGroupNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: invalidationTopic } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: invalidationTopic },
          queue: { QueueName: `group-trigger-peer-q-${suffix}` },
        },
      },
    })

    const loader = new GroupLoader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new StubGroupedAsyncCache('value'),
      notificationConsumer: peer.consumer,
      notificationPublisher: peer.publisher,
    })

    const upstreamTopicName = `tenant-events-${suffix}`
    const upstreamTopicArn = (
      await clients.snsClient.send(new CreateTopicCommand({ Name: upstreamTopicName }))
    ).TopicArn!

    const trigger = new SnsTopicGroupInvalidationTrigger({
      target: loader,
      dependencies: buildConsumerDeps(clients),
      sources: [
        {
          creationConfig: {
            topic: { Name: upstreamTopicName },
            queue: { QueueName: `group-trigger-q-${suffix}` },
          },
          bindings: [
            {
              messageSchema: TENANT_EVENT_SCHEMA,
              resolver: (msg: TenantEvent) => {
                if (msg.type === 'tenant.purged') {
                  return { kind: 'deleteGroup', group: msg.tenantId }
                }
                if (msg.type === 'tenant.user.updated' && msg.userId) {
                  return { kind: 'deleteFromGroup', key: msg.userId, group: msg.tenantId }
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

      await loader.getAsyncOnly('user-1', 'tenant-A')
      await loader.getAsyncOnly('user-2', 'tenant-A')
      await loader.getAsyncOnly('user-1', 'tenant-B')

      await clients.snsClient.send(
        new PublishCommand({
          TopicArn: upstreamTopicArn,
          Message: JSON.stringify({
            type: 'tenant.user.updated',
            tenantId: 'tenant-A',
            userId: 'user-1',
          }),
        }),
      )
      await waitFor(() => loader.getInMemoryOnly('user-1', 'tenant-A') === undefined)
      expect(loader.getInMemoryOnly('user-2', 'tenant-A')).toBe('value')
      expect(loader.getInMemoryOnly('user-1', 'tenant-B')).toBe('value')

      await clients.snsClient.send(
        new PublishCommand({
          TopicArn: upstreamTopicArn,
          Message: JSON.stringify({ type: 'tenant.purged', tenantId: 'tenant-A' }),
        }),
      )
      await waitFor(() => loader.getInMemoryOnly('user-2', 'tenant-A') === undefined)
      expect(loader.getInMemoryOnly('user-1', 'tenant-B')).toBe('value')
    } finally {
      await Promise.allSettled([trigger.stop(), peer.consumer.close(), peer.publisher.close()])
    }
  })

  it('routes different event types from the same topic to different resolvers', async () => {
    const suffix = Math.random().toString(36).slice(2, 8)
    const invalidationTopic = `group-routed-${suffix}`

    const peer = createGroupNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: invalidationTopic } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: invalidationTopic },
          queue: { QueueName: `group-routed-peer-q-${suffix}` },
        },
      },
    })

    const loader = new GroupLoader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new StubGroupedAsyncCache('value'),
      notificationConsumer: peer.consumer,
      notificationPublisher: peer.publisher,
    })

    const upstreamTopicName = `group-routed-domain-${suffix}`
    const upstreamTopicArn = (
      await clients.snsClient.send(new CreateTopicCommand({ Name: upstreamTopicName }))
    ).TopicArn!

    const USER_UPDATED = z.object({
      type: z.literal('tenant.user.updated'),
      tenantId: z.string(),
      userId: z.string(),
    })
    const TENANT_PURGED = z.object({
      type: z.literal('tenant.purged'),
      tenantId: z.string(),
    })

    const trigger = new SnsTopicGroupInvalidationTrigger({
      target: loader,
      dependencies: buildConsumerDeps(clients),
      sources: [
        {
          creationConfig: {
            topic: { Name: upstreamTopicName },
            queue: { QueueName: `group-routed-q-${suffix}` },
          },
          messageTypeField: 'type',
          bindings: [
            {
              messageType: 'tenant.user.updated',
              messageSchema: USER_UPDATED,
              resolver: (m: z.infer<typeof USER_UPDATED>) => ({
                kind: 'deleteFromGroup',
                key: m.userId,
                group: m.tenantId,
              }),
            },
            {
              messageType: 'tenant.purged',
              messageSchema: TENANT_PURGED,
              resolver: (m: z.infer<typeof TENANT_PURGED>) => ({
                kind: 'deleteGroup',
                group: m.tenantId,
              }),
            },
          ],
        },
      ],
    })

    try {
      await loader.init()
      await trigger.start()

      await loader.getAsyncOnly('u1', 'g1')
      await loader.getAsyncOnly('u2', 'g1')

      await clients.snsClient.send(
        new PublishCommand({
          TopicArn: upstreamTopicArn,
          Message: JSON.stringify({ type: 'tenant.user.updated', tenantId: 'g1', userId: 'u1' }),
        }),
      )
      await waitFor(() => loader.getInMemoryOnly('u1', 'g1') === undefined)
      expect(loader.getInMemoryOnly('u2', 'g1')).toBe('value')

      await clients.snsClient.send(
        new PublishCommand({
          TopicArn: upstreamTopicArn,
          Message: JSON.stringify({ type: 'tenant.purged', tenantId: 'g1' }),
        }),
      )
      await waitFor(() => loader.getInMemoryOnly('u2', 'g1') === undefined)
    } finally {
      await Promise.allSettled([trigger.stop(), peer.consumer.close(), peer.publisher.close()])
    }
  })
})

describe('SqsQueueGroupInvalidationTrigger', () => {
  let clients: AwsClientBundle

  beforeAll(() => {
    const endpoint = process.env.FAUXQS_ENDPOINT
    if (!endpoint) throw new Error('FAUXQS_ENDPOINT is not set; globalSetup did not run')
    clients = buildAwsClients(endpoint)
  })

  afterAll(() => {
    clients.destroy()
  })

  it('applies tenant invalidations from a pre-existing SQS queue', async () => {
    const suffix = Math.random().toString(36).slice(2, 8)
    const invalidationTopic = `group-sqs-${suffix}`

    const peer = createGroupNotificationPair<string>({
      publisher: {
        dependencies: buildPublisherDeps(clients),
        creationConfig: { topic: { Name: invalidationTopic } },
      },
      consumer: {
        dependencies: buildConsumerDeps(clients),
        creationConfig: {
          topic: { Name: invalidationTopic },
          queue: { QueueName: `group-sqs-peer-q-${suffix}` },
        },
      },
    })

    const loader = new GroupLoader<string>({
      inMemoryCache: IN_MEMORY_CACHE_CONFIG,
      asyncCache: new StubGroupedAsyncCache('value'),
      notificationConsumer: peer.consumer,
      notificationPublisher: peer.publisher,
    })

    const upstreamQueueName = `group-sqs-src-${suffix}`
    await clients.sqsClient.send(new CreateQueueCommand({ QueueName: upstreamQueueName }))
    const queueUrl = (
      await clients.sqsClient.send(new GetQueueUrlCommand({ QueueName: upstreamQueueName }))
    ).QueueUrl!

    const trigger = new SqsQueueGroupInvalidationTrigger({
      target: loader,
      dependencies: buildConsumerDeps(clients),
      sources: [
        {
          locatorConfig: { queueUrl },
          bindings: [
            {
              messageSchema: TENANT_EVENT_SCHEMA,
              resolver: (m: TenantEvent) =>
                m.type === 'tenant.purged'
                  ? { kind: 'deleteGroup', group: m.tenantId }
                  : m.userId
                    ? { kind: 'deleteFromGroup', key: m.userId, group: m.tenantId }
                    : null,
            },
          ],
        },
      ],
    })

    try {
      await loader.init()
      await trigger.start()

      await loader.getAsyncOnly('u1', 'g1')

      await clients.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify({
            type: 'tenant.user.updated',
            tenantId: 'g1',
            userId: 'u1',
          }),
        }),
      )
      await waitFor(() => loader.getInMemoryOnly('u1', 'g1') === undefined)
    } finally {
      await Promise.allSettled([trigger.stop(), peer.consumer.close(), peer.publisher.close()])
    }
  })
})
