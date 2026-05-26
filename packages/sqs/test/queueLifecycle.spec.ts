import {
  GetQueueUrlCommand,
  ListQueueTagsCommand,
  ListQueuesCommand,
} from '@aws-sdk/client-sqs'
import { ListSubscriptionsByTopicCommand } from '@aws-sdk/client-sns'
import { Loader, type InMemoryCacheConfiguration } from 'layered-loader'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  HEARTBEAT_TAG_KEY,
  reapStaleQueues,
} from '../lib/queueLifecycle.js'
import { createNotificationPair } from '../lib/SqsNotificationFactory.js'
import { type AwsClientBundle, buildAwsClients } from './fakes/awsClients.js'
import { buildConsumerDeps, buildPublisherDeps } from './fakes/dependencies.js'
import { StubAsyncCache, uniqueSuffix, waitFor } from './utils/testHelpers.js'

const IN_MEMORY_CACHE_CONFIG = { ttlInMsecs: 99999 } satisfies InMemoryCacheConfiguration

async function queueExists(
  clients: AwsClientBundle,
  queueName: string,
): Promise<boolean> {
  try {
    await clients.sqsClient.send(new GetQueueUrlCommand({ QueueName: queueName }))
    return true
  } catch {
    return false
  }
}

async function subscriptionExists(
  clients: AwsClientBundle,
  topicArn: string,
  subscriptionArn: string,
): Promise<boolean> {
  const resp = await clients.snsClient.send(
    new ListSubscriptionsByTopicCommand({ TopicArn: topicArn }),
  )
  return (resp.Subscriptions ?? []).some((s) => s.SubscriptionArn === subscriptionArn)
}

describe('queue lifecycle helpers', () => {
  let clients: AwsClientBundle

  beforeAll(() => {
    const endpoint = process.env.FAUXQS_ENDPOINT
    if (!endpoint) throw new Error('FAUXQS_ENDPOINT is not set; globalSetup did not run')
    clients = buildAwsClients(endpoint)
  })

  afterAll(() => {
    clients.destroy()
  })

  describe('deleteQueueOnClose / unsubscribeOnClose', () => {
    let suffix: string

    beforeEach(() => {
      suffix = uniqueSuffix()
    })

    it('deletes the queue and unsubscribes when close() is called with both flags', async () => {
      const queueName = `lifecycle-cleanup-${suffix}`
      const topicName = `lifecycle-topic-${suffix}`

      const { publisher, consumer } = createNotificationPair<string>({
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
          lifecycle: { deleteQueueOnClose: true, unsubscribeOnClose: true },
        },
      })

      const loader = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: consumer,
        notificationPublisher: publisher,
      })

      await loader.init()
      const topicArn = publisher.topicArn
      const subscriptionArn = consumer.subscriptionArn
      expect(topicArn).toBeTruthy()
      expect(subscriptionArn).toBeTruthy()
      expect(await queueExists(clients, queueName)).toBe(true)

      await consumer.close()
      await publisher.close()

      // Both resources should be gone. Subscription cleanup runs against SNS;
      // queue cleanup against SQS.
      expect(await queueExists(clients, queueName)).toBe(false)
      expect(await subscriptionExists(clients, topicArn!, subscriptionArn!)).toBe(false)
    })

    it('does not delete the queue when the flag is off (default)', async () => {
      const queueName = `lifecycle-keep-${suffix}`
      const topicName = `lifecycle-keep-topic-${suffix}`

      const { publisher, consumer } = createNotificationPair<string>({
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

      const loader = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: consumer,
        notificationPublisher: publisher,
      })

      try {
        await loader.init()
        await consumer.close()
        await publisher.close()
        // Queue should still be there: the user has not opted in to cleanup.
        expect(await queueExists(clients, queueName)).toBe(true)
      } finally {
        // Manual cleanup so we don't leak fauxqs state across tests.
        await clients.sqsClient
          .send(
            new (await import('@aws-sdk/client-sqs')).DeleteQueueCommand({
              QueueUrl: (
                await clients.sqsClient.send(new GetQueueUrlCommand({ QueueName: queueName }))
              ).QueueUrl,
            }),
          )
          .catch(() => undefined)
      }
    })
  })

  describe('heartbeat tagging', () => {
    it('tags the queue with the heartbeat key after subscribe', async () => {
      const suffix = uniqueSuffix()
      const queueName = `heartbeat-${suffix}`
      const topicName = `heartbeat-topic-${suffix}`

      const { publisher, consumer } = createNotificationPair<string>({
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
          lifecycle: {
            deleteQueueOnClose: true,
            heartbeat: { intervalMs: 50 },
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
        const queueUrl = consumer.queueUrl!

        // Wait for the eager first beat to land. The runner kicks off
        // tag-write fire-and-forget, so we poll briefly.
        let heartbeatValue: string | undefined
        await waitFor(async () => {
          const tags = await clients.sqsClient.send(
            new ListQueueTagsCommand({ QueueUrl: queueUrl }),
          )
          heartbeatValue = tags.Tags?.[HEARTBEAT_TAG_KEY]
          return Boolean(heartbeatValue)
        })

        const first = Number.parseInt(heartbeatValue!, 10)
        expect(Number.isFinite(first)).toBe(true)
        expect(Math.abs(Date.now() - first)).toBeLessThan(5000)

        // A second beat should land on the next tick (50ms interval), with a
        // newer timestamp.
        await waitFor(async () => {
          const tags = await clients.sqsClient.send(
            new ListQueueTagsCommand({ QueueUrl: queueUrl }),
          )
          const next = Number.parseInt(tags.Tags?.[HEARTBEAT_TAG_KEY] ?? '0', 10)
          return next > first
        })
      } finally {
        await consumer.close()
        await publisher.close()
      }
    })
  })

  describe('reapStaleQueues', () => {
    it('deletes queues whose heartbeat is older than the threshold and leaves fresh ones alone', async () => {
      const suffix = uniqueSuffix()
      const prefix = `reap-${suffix}-`
      const topicName = `reap-topic-${suffix}`

      // Fresh consumer with active heartbeat.
      const fresh = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: topicName } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: topicName },
            queue: { QueueName: `${prefix}fresh` },
          },
          lifecycle: { heartbeat: { intervalMs: 100 } },
        },
      })
      const freshLoader = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: fresh.consumer,
        notificationPublisher: fresh.publisher,
      })
      await freshLoader.init()

      // Stale consumer: same setup, then we'll stop its heartbeat and rewrite
      // the tag to an old timestamp to simulate abandonment.
      const stale = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: topicName } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: topicName },
            queue: { QueueName: `${prefix}stale` },
          },
          lifecycle: { heartbeat: { intervalMs: 100 } },
        },
      })
      const staleLoader = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: stale.consumer,
        notificationPublisher: stale.publisher,
      })
      await staleLoader.init()

      // Wait for both to have written at least one heartbeat tag.
      const freshUrl = fresh.consumer.queueUrl!
      const staleUrl = stale.consumer.queueUrl!
      const staleSubscriptionArn = stale.consumer.subscriptionArn!
      const topicArn = stale.publisher.topicArn!

      await waitFor(async () => {
        const t = await clients.sqsClient.send(new ListQueueTagsCommand({ QueueUrl: freshUrl }))
        return Boolean(t.Tags?.[HEARTBEAT_TAG_KEY])
      })

      // Stop the stale consumer's polling and reaper-trigger by rewriting its
      // tag to an ancient timestamp. Closing the consumer also stops its
      // internal heartbeat timer, so the tag will not get overwritten.
      await stale.consumer.close()
      const { TagQueueCommand } = await import('@aws-sdk/client-sqs')
      await clients.sqsClient.send(
        new TagQueueCommand({
          QueueUrl: staleUrl,
          Tags: { [HEARTBEAT_TAG_KEY]: '1' /* 1970, definitely stale */ },
        }),
      )

      const result = await reapStaleQueues({
        sqsClient: clients.sqsClient,
        snsClient: clients.snsClient,
        topicArn,
        queueNamePrefix: prefix,
        idleThresholdMs: 1000,
      })

      try {
        expect(result.deleted.map((u) => u.split('/').pop())).toEqual([
          `${prefix}stale`,
        ])
        expect(result.skipped.map((u) => u.split('/').pop())).toEqual([
          `${prefix}fresh`,
        ])
        expect(result.unsubscribed).toContain(staleSubscriptionArn)
        // The reaper should not touch the fresh consumer's queue or subscription.
        expect(await queueExists(clients, `${prefix}fresh`)).toBe(true)
        expect(await queueExists(clients, `${prefix}stale`)).toBe(false)
        expect(
          await subscriptionExists(clients, topicArn, staleSubscriptionArn),
        ).toBe(false)
      } finally {
        await fresh.consumer.close()
        await fresh.publisher.close()
        await stale.publisher.close()
        // The stale consumer is already closed above.
      }
    })

    it('honors dryRun by reporting deletions without performing them', async () => {
      const suffix = uniqueSuffix()
      const prefix = `dryrun-${suffix}-`
      const topicName = `dryrun-topic-${suffix}`

      const pair = createNotificationPair<string>({
        publisher: {
          dependencies: buildPublisherDeps(clients),
          creationConfig: { topic: { Name: topicName } },
        },
        consumer: {
          dependencies: buildConsumerDeps(clients),
          creationConfig: {
            topic: { Name: topicName },
            queue: { QueueName: `${prefix}old` },
          },
        },
      })
      const loader = new Loader<string>({
        inMemoryCache: IN_MEMORY_CACHE_CONFIG,
        asyncCache: new StubAsyncCache('value'),
        notificationConsumer: pair.consumer,
        notificationPublisher: pair.publisher,
      })

      try {
        await loader.init()
        // Tag with an ancient heartbeat so it would be reaped — but dryRun.
        const queueUrl = pair.consumer.queueUrl!
        const { TagQueueCommand } = await import('@aws-sdk/client-sqs')
        await clients.sqsClient.send(
          new TagQueueCommand({
            QueueUrl: queueUrl,
            Tags: { [HEARTBEAT_TAG_KEY]: '1' },
          }),
        )

        const result = await reapStaleQueues({
          sqsClient: clients.sqsClient,
          queueNamePrefix: prefix,
          idleThresholdMs: 1000,
          dryRun: true,
        })

        expect(result.deleted.length).toBe(1)
        expect(await queueExists(clients, `${prefix}old`)).toBe(true)
      } finally {
        await pair.consumer.close()
        await pair.publisher.close()
      }
    })
  })
})
