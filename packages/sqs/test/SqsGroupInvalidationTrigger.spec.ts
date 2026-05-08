import { randomUUID } from 'node:crypto'
import { CreateTopicCommand, PublishCommand } from '@aws-sdk/client-sns'
import { GroupLoader, type InMemoryCacheConfiguration } from 'layered-loader'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createGroupNotificationPair } from '../lib/SqsGroupNotificationFactory.js'
import { SqsGroupNotificationPublisher } from '../lib/SqsGroupNotificationPublisher.js'
import { SqsGroupInvalidationTrigger } from '../lib/triggers/SqsGroupInvalidationTrigger.js'
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

const TENANT_EVENT_SCHEMA = z.object({
  type: z.enum(['tenant.user.updated', 'tenant.purged']),
  tenantId: z.string(),
  userId: z.string().optional(),
})
type TenantEvent = z.infer<typeof TENANT_EVENT_SCHEMA>

describe('SqsGroupInvalidationTrigger', () => {
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
    const createTopic = await clients.snsClient.send(
      new CreateTopicCommand({ Name: upstreamTopicName }),
    )
    const upstreamTopicArn = createTopic.TopicArn!

    const triggerPublisher = new SqsGroupNotificationPublisher<string>({
      serverUuid: randomUUID(),
      dependencies: buildPublisherDeps(clients),
      locatorConfig: { topicName: invalidationTopic },
    })

    const trigger = new SqsGroupInvalidationTrigger<TenantEvent>({
      sourceType: 'sns-topic',
      dependencies: buildConsumerDeps(clients),
      creationConfig: {
        topic: { Name: upstreamTopicName },
        queue: { QueueName: `group-trigger-q-${suffix}` },
      },
      messageSchema: TENANT_EVENT_SCHEMA,
      publisher: triggerPublisher,
      resolver: (msg) => {
        if (msg.type === 'tenant.purged') {
          return { kind: 'deleteGroup', group: msg.tenantId }
        }
        if (msg.type === 'tenant.user.updated' && msg.userId) {
          return { kind: 'deleteFromGroup', key: msg.userId, group: msg.tenantId }
        }
        return null
      },
    })

    try {
      await loader.init()
      await trigger.start()

      await loader.getAsyncOnly('user-1', 'tenant-A')
      await loader.getAsyncOnly('user-2', 'tenant-A')
      await loader.getAsyncOnly('user-1', 'tenant-B')
      expect(loader.getInMemoryOnly('user-1', 'tenant-A')).toBe('value')

      // single-key invalidation
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
      expect(loader.getInMemoryOnly('user-1', 'tenant-A')).toBeUndefined()
      expect(loader.getInMemoryOnly('user-2', 'tenant-A')).toBe('value')
      expect(loader.getInMemoryOnly('user-1', 'tenant-B')).toBe('value')

      // whole-group invalidation
      await clients.snsClient.send(
        new PublishCommand({
          TopicArn: upstreamTopicArn,
          Message: JSON.stringify({ type: 'tenant.purged', tenantId: 'tenant-A' }),
        }),
      )
      await waitFor(() => loader.getInMemoryOnly('user-2', 'tenant-A') === undefined)
      expect(loader.getInMemoryOnly('user-2', 'tenant-A')).toBeUndefined()
      // Sibling tenant unaffected
      expect(loader.getInMemoryOnly('user-1', 'tenant-B')).toBe('value')
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
