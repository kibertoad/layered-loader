import type { SubscribeCommandInput } from '@aws-sdk/client-sns'
import { MessageHandlerConfigBuilder } from '@message-queue-toolkit/core'
import {
  AbstractSnsSqsConsumer,
  type SNSSQSConsumerDependencies,
  type SNSSQSConsumerOptions,
  type SNSSQSCreationConfig,
  type SNSSQSQueueLocatorType,
} from '@message-queue-toolkit/sns'
import type { ConsumerErrorHandler, SynchronousCache } from 'layered-loader'
import { AbstractNotificationConsumer } from 'layered-loader'
import {
  CLEAR_NOTIFICATION_SCHEMA,
  DELETE_MANY_NOTIFICATION_SCHEMA,
  DELETE_NOTIFICATION_SCHEMA,
  type NotificationCommand,
  NOTIFICATION_ID_FIELD,
  NOTIFICATION_TIMESTAMP_FIELD,
  NOTIFICATION_TYPE_FIELD,
  SET_NOTIFICATION_SCHEMA,
} from './notificationSchemas.js'

/**
 * Mirror of `SNSSubscriptionOptions` from `@message-queue-toolkit/sns/utils/snsSubscriber`,
 * which is not re-exported from the package's main entry point.
 */
export type SqsSubscriptionOptions = Omit<
  SubscribeCommandInput,
  'TopicArn' | 'Endpoint' | 'Protocol' | 'ReturnSubscriptionArn'
> & {
  updateAttributesIfExists: boolean
}

export type SqsNotificationConsumerConfig =
  | { creationConfig: SNSSQSCreationConfig; locatorConfig?: never }
  | { creationConfig?: never; locatorConfig: SNSSQSQueueLocatorType }

export type SqsNotificationConsumerParams = {
  serverUuid: string
  errorHandler?: ConsumerErrorHandler
  dependencies: SNSSQSConsumerDependencies
  subscriptionConfig?: SqsSubscriptionOptions
} & SqsNotificationConsumerConfig

type ConsumerContext<LoadedValue> = {
  serverUuid: string
  targetCache: SynchronousCache<LoadedValue>
}

class SnsSqsInvalidationConsumer<LoadedValue> extends AbstractSnsSqsConsumer<
  NotificationCommand,
  ConsumerContext<LoadedValue>
> {
  constructor(
    dependencies: SNSSQSConsumerDependencies,
    options: SNSSQSConsumerOptions<NotificationCommand, ConsumerContext<LoadedValue>, undefined>,
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

export class SqsNotificationConsumer<LoadedValue> extends AbstractNotificationConsumer<LoadedValue> {
  private readonly params: SqsNotificationConsumerParams
  private internalConsumer?: SnsSqsInvalidationConsumer<LoadedValue>
  private subscribePromise?: Promise<SnsSqsInvalidationConsumer<LoadedValue>>

  constructor(params: SqsNotificationConsumerParams) {
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
      NotificationCommand,
      ConsumerContext<LoadedValue>
    >()
      .addConfig(DELETE_NOTIFICATION_SCHEMA, async (message, ctx) => {
        if (message.originUuid !== ctx.serverUuid) {
          ctx.targetCache.delete(message.key)
        }
        return { result: 'success' }
      })
      .addConfig(DELETE_MANY_NOTIFICATION_SCHEMA, async (message, ctx) => {
        if (message.originUuid !== ctx.serverUuid) {
          ctx.targetCache.deleteMany(message.keys)
        }
        return { result: 'success' }
      })
      .addConfig(CLEAR_NOTIFICATION_SCHEMA, async (message, ctx) => {
        if (message.originUuid !== ctx.serverUuid) {
          ctx.targetCache.clear()
        }
        return { result: 'success' }
      })
      .addConfig(SET_NOTIFICATION_SCHEMA, async (message, ctx) => {
        if (message.originUuid !== ctx.serverUuid) {
          ctx.targetCache.set(message.key, (message.value as LoadedValue | null) ?? null)
        }
        return { result: 'success' }
      })
      .build()

    const options = {
      handlers,
      messageTypeResolver: { messageTypePath: NOTIFICATION_TYPE_FIELD },
      messageIdField: NOTIFICATION_ID_FIELD,
      messageTimestampField: NOTIFICATION_TIMESTAMP_FIELD,
      subscriptionConfig: this.params.subscriptionConfig ?? { updateAttributesIfExists: false },
      ...(this.params.creationConfig
        ? { creationConfig: this.params.creationConfig }
        : { locatorConfig: this.params.locatorConfig }),
    } as SNSSQSConsumerOptions<NotificationCommand, ConsumerContext<LoadedValue>, undefined>

    const consumer = new SnsSqsInvalidationConsumer<LoadedValue>(
      this.params.dependencies,
      options,
      { serverUuid: this.serverUuid, targetCache: this.targetCache },
    )

    // Single-flight: concurrent subscribe() calls share one init/start; the
    // internal consumer is only assigned once both succeed, so a partial
    // failure leaves the instance in a re-tryable state.
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

  /**
   * Returns the resolved topic ARN. Available only after subscribe() has completed.
   */
  get topicArn(): string | undefined {
    return this.internalConsumer?.publicTopicArn
  }

  /**
   * Returns the resolved subscription ARN. Available only after subscribe() has completed.
   */
  get subscriptionArn(): string | undefined {
    return this.internalConsumer?.publicSubscriptionArn
  }

  /**
   * Returns the resolved queue URL. Available only after subscribe() has completed.
   */
  get queueUrl(): string | undefined {
    return this.internalConsumer?.publicQueueUrl
  }
}
