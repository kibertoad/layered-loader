import { randomUUID } from 'node:crypto'
import type { SNSDependencies, SNSSQSConsumerDependencies } from '@message-queue-toolkit/sns'
import type { ConsumerErrorHandler, PublisherErrorHandler } from 'layered-loader'
import {
  SqsGroupNotificationConsumer,
  type SqsGroupNotificationConsumerConfig,
} from './SqsGroupNotificationConsumer.js'
import {
  SqsGroupNotificationPublisher,
  type SqsGroupNotificationPublisherConfig,
} from './SqsGroupNotificationPublisher.js'
import type { SqsSubscriptionOptions } from './SqsNotificationConsumer.js'

export type SqsGroupNotificationConfig = {
  channel?: string
  serverUuid?: string
  publisherErrorHandler?: PublisherErrorHandler
  consumerErrorHandler?: ConsumerErrorHandler
  publisher: {
    dependencies: SNSDependencies
  } & SqsGroupNotificationPublisherConfig
  consumer: {
    dependencies: SNSSQSConsumerDependencies
    subscriptionConfig?: SqsSubscriptionOptions
  } & SqsGroupNotificationConsumerConfig
}

export function createGroupNotificationPair<LoadedValue>(config: SqsGroupNotificationConfig): {
  publisher: SqsGroupNotificationPublisher<LoadedValue>
  consumer: SqsGroupNotificationConsumer<LoadedValue>
} {
  const serverUuid = config.serverUuid ?? randomUUID()

  const publisherConfig = config.publisher
  const consumerConfig = config.consumer

  const publisher = new SqsGroupNotificationPublisher<LoadedValue>(
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

  const consumer = new SqsGroupNotificationConsumer<LoadedValue>(
    consumerConfig.creationConfig
      ? {
          serverUuid,
          errorHandler: config.consumerErrorHandler,
          dependencies: consumerConfig.dependencies,
          subscriptionConfig: consumerConfig.subscriptionConfig,
          creationConfig: consumerConfig.creationConfig,
        }
      : {
          serverUuid,
          errorHandler: config.consumerErrorHandler,
          dependencies: consumerConfig.dependencies,
          subscriptionConfig: consumerConfig.subscriptionConfig,
          locatorConfig: consumerConfig.locatorConfig,
        },
  )

  return { publisher, consumer }
}
