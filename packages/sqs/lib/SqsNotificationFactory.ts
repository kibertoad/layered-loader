import { randomUUID } from 'node:crypto'
import type { SNSDependencies, SNSSQSConsumerDependencies } from '@message-queue-toolkit/sns'
import type { ConsumerErrorHandler, PublisherErrorHandler } from 'layered-loader'
import type { QueueLifecycleOptions } from './queueLifecycle.js'
import {
  SqsNotificationConsumer,
  type SqsNotificationConsumerConfig,
  type SqsSubscriptionOptions,
} from './SqsNotificationConsumer.js'
import {
  SqsNotificationPublisher,
  type SqsNotificationPublisherConfig,
} from './SqsNotificationPublisher.js'

export type SqsNotificationConfig = {
  /**
   * Logical channel name used for error reporting.
   * Defaults to the topic name/ARN derived from the publisher config.
   */
  channel?: string
  /**
   * Stable identifier for this process. When omitted, a random UUID is generated.
   * Messages whose `originUuid` matches this value are treated as self-emitted and skipped.
   */
  serverUuid?: string
  publisherErrorHandler?: PublisherErrorHandler
  consumerErrorHandler?: ConsumerErrorHandler
  publisher: {
    dependencies: SNSDependencies
  } & SqsNotificationPublisherConfig
  consumer: {
    dependencies: SNSSQSConsumerDependencies
    subscriptionConfig?: SqsSubscriptionOptions
    /**
     * Optional queue-lifecycle behaviour. Only relevant when each instance owns
     * its own SQS queue (the default shape for full SNS/SQS fanout). Setups
     * that pair this consumer with a Redis publisher and a shared queue do not
     * need any of these knobs.
     */
    lifecycle?: QueueLifecycleOptions
  } & SqsNotificationConsumerConfig
}

export function createNotificationPair<LoadedValue>(config: SqsNotificationConfig): {
  publisher: SqsNotificationPublisher<LoadedValue>
  consumer: SqsNotificationConsumer<LoadedValue>
} {
  const serverUuid = config.serverUuid ?? randomUUID()

  const publisherConfig = config.publisher
  const consumerConfig = config.consumer

  const publisher = new SqsNotificationPublisher<LoadedValue>(
    publisherConfig.creationConfig
      ? {
          serverUuid,
          channel: config.channel,
          errorHandler: config.publisherErrorHandler,
          dependencies: publisherConfig.dependencies,
          creationConfig: publisherConfig.creationConfig,
        }
      : {
          serverUuid,
          channel: config.channel,
          errorHandler: config.publisherErrorHandler,
          dependencies: publisherConfig.dependencies,
          locatorConfig: publisherConfig.locatorConfig,
        },
  )

  const consumer = new SqsNotificationConsumer<LoadedValue>(
    consumerConfig.creationConfig
      ? {
          serverUuid,
          errorHandler: config.consumerErrorHandler,
          dependencies: consumerConfig.dependencies,
          subscriptionConfig: consumerConfig.subscriptionConfig,
          lifecycle: consumerConfig.lifecycle,
          creationConfig: consumerConfig.creationConfig,
        }
      : {
          serverUuid,
          errorHandler: config.consumerErrorHandler,
          dependencies: consumerConfig.dependencies,
          subscriptionConfig: consumerConfig.subscriptionConfig,
          lifecycle: consumerConfig.lifecycle,
          locatorConfig: consumerConfig.locatorConfig,
        },
  )

  return { publisher, consumer }
}
