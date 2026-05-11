import { MessageHandlerConfigBuilder } from '@message-queue-toolkit/core'
import {
  AbstractSnsSqsConsumer,
  type SNSSQSConsumerDependencies,
  type SNSSQSConsumerOptions,
  type SNSSQSCreationConfig,
  type SNSSQSQueueLocatorType,
} from '@message-queue-toolkit/sns'
import type { ConsumerErrorHandler, SynchronousGroupCache } from 'layered-loader'
import { AbstractNotificationConsumer } from 'layered-loader'
import type { SqsSubscriptionOptions } from './SqsNotificationConsumer.js'
import {
  CLEAR_GROUP_NOTIFICATION_SCHEMA,
  DELETE_FROM_GROUP_NOTIFICATION_SCHEMA,
  DELETE_GROUP_NOTIFICATION_SCHEMA,
  type GroupNotificationCommand,
  NOTIFICATION_ID_FIELD,
  NOTIFICATION_TIMESTAMP_FIELD,
  NOTIFICATION_TYPE_FIELD,
} from './groupNotificationSchemas.js'

export type SqsGroupNotificationConsumerConfig =
  | { creationConfig: SNSSQSCreationConfig; locatorConfig?: never }
  | { creationConfig?: never; locatorConfig: SNSSQSQueueLocatorType }

export type SqsGroupNotificationConsumerParams = {
  serverUuid: string
  errorHandler?: ConsumerErrorHandler
  dependencies: SNSSQSConsumerDependencies
  subscriptionConfig?: SqsSubscriptionOptions
} & SqsGroupNotificationConsumerConfig

type ConsumerContext<LoadedValue> = {
  serverUuid: string
  targetCache: SynchronousGroupCache<LoadedValue>
}

class SnsSqsGroupInvalidationConsumer<LoadedValue> extends AbstractSnsSqsConsumer<
  GroupNotificationCommand,
  ConsumerContext<LoadedValue>
> {
  constructor(
    dependencies: SNSSQSConsumerDependencies,
    options: SNSSQSConsumerOptions<
      GroupNotificationCommand,
      ConsumerContext<LoadedValue>,
      undefined
    >,
    context: ConsumerContext<LoadedValue>,
  ) {
    super(dependencies, options, context)
  }

  get publicTopicArn(): string {
    return this.topicArn
  }

  get publicSubscriptionArn(): string {
    return this.subscriptionArn
  }

  get publicQueueUrl(): string {
    return this.queueUrl
  }
}

export class SqsGroupNotificationConsumer<LoadedValue> extends AbstractNotificationConsumer<
  LoadedValue,
  SynchronousGroupCache<LoadedValue>
> {
  private readonly params: SqsGroupNotificationConsumerParams
  private internalConsumer?: SnsSqsGroupInvalidationConsumer<LoadedValue>
  private subscribePromise?: Promise<SnsSqsGroupInvalidationConsumer<LoadedValue>>

  constructor(params: SqsGroupNotificationConsumerParams) {
    super(params.serverUuid, params.errorHandler)
    this.params = params
  }

  async subscribe(): Promise<unknown> {
    if (this.internalConsumer) {
      return this.internalConsumer
    }
    if (this.subscribePromise) {
      return this.subscribePromise
    }

    if (!this.targetCache) {
      throw new Error(
        'targetCache must be set via setTargetCache() before subscribe() is called',
      )
    }

    const handlers = new MessageHandlerConfigBuilder<
      GroupNotificationCommand,
      ConsumerContext<LoadedValue>
    >()
      .addConfig(DELETE_FROM_GROUP_NOTIFICATION_SCHEMA, async (message, ctx) => {
        if (message.originUuid !== ctx.serverUuid) {
          ctx.targetCache.deleteFromGroup(message.key, message.group)
        }
        return { result: 'success' }
      })
      .addConfig(DELETE_GROUP_NOTIFICATION_SCHEMA, async (message, ctx) => {
        if (message.originUuid !== ctx.serverUuid) {
          ctx.targetCache.deleteGroup(message.group)
        }
        return { result: 'success' }
      })
      .addConfig(CLEAR_GROUP_NOTIFICATION_SCHEMA, async (message, ctx) => {
        if (message.originUuid !== ctx.serverUuid) {
          ctx.targetCache.clear()
        }
        return { result: 'success' }
      })
      .build()

    const options: SNSSQSConsumerOptions<
      GroupNotificationCommand,
      ConsumerContext<LoadedValue>,
      undefined
    > = {
      handlers,
      messageTypeResolver: { messageTypePath: NOTIFICATION_TYPE_FIELD },
      messageIdField: NOTIFICATION_ID_FIELD,
      messageTimestampField: NOTIFICATION_TIMESTAMP_FIELD,
      subscriptionConfig: this.params.subscriptionConfig ?? { updateAttributesIfExists: false },
      ...(this.params.creationConfig
        ? { creationConfig: this.params.creationConfig }
        : { locatorConfig: this.params.locatorConfig }),
    }

    const consumer = new SnsSqsGroupInvalidationConsumer<LoadedValue>(
      this.params.dependencies,
      options,
      { serverUuid: this.serverUuid, targetCache: this.targetCache },
    )

    // Single-flight: concurrent subscribe() calls share one init/start; the
    // internal consumer is only assigned once both succeed.
    this.subscribePromise = (async () => {
      try {
        await consumer.init()
        await consumer.start()
        this.internalConsumer = consumer
        return consumer
      } catch (err) {
        await consumer.close().catch(() => undefined)
        throw err
      } finally {
        this.subscribePromise = undefined
      }
    })()
    return this.subscribePromise
  }

  async close(): Promise<void> {
    if (this.subscribePromise) {
      await this.subscribePromise.catch(() => undefined)
    }
    if (!this.internalConsumer) return
    const consumer = this.internalConsumer
    this.internalConsumer = undefined
    await consumer.close()
  }

  get topicArn(): string | undefined {
    return this.internalConsumer?.publicTopicArn
  }

  get subscriptionArn(): string | undefined {
    return this.internalConsumer?.publicSubscriptionArn
  }

  get queueUrl(): string | undefined {
    return this.internalConsumer?.publicQueueUrl
  }
}
