import { UnsubscribeCommand } from '@aws-sdk/client-sns'
import { DeleteQueueCommand } from '@aws-sdk/client-sqs'
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
import {
  type HeartbeatRunner,
  isQueueNotFound,
  isSubscriptionNotFound,
  PENDING_CONFIRMATION_ARN,
  type QueueLifecycleOptions,
  startQueueHeartbeat,
} from './queueLifecycle.js'
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
  /**
   * Optional queue-lifecycle behaviour. When set, controls automatic queue
   * cleanup on close and/or periodic heartbeat tagging used by
   * `reapStaleQueues`. See {@link QueueLifecycleOptions}.
   */
  lifecycle?: QueueLifecycleOptions
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
  private heartbeat?: HeartbeatRunner

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
        if (this.params.lifecycle?.heartbeat) {
          this.heartbeat = startQueueHeartbeat({
            sqsClient: this.params.dependencies.sqsClient,
            queueUrl: consumer.publicQueueUrl,
            intervalMs: this.params.lifecycle.heartbeat.intervalMs,
            errorHandler: this.params.lifecycle.heartbeat.errorHandler,
          })
        }
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

    this.heartbeat?.stop()
    this.heartbeat = undefined

    const queueUrl = consumer.publicQueueUrl
    const subscriptionArn = consumer.publicSubscriptionArn
    const unsubscribeOnClose = this.params.lifecycle?.unsubscribeOnClose ?? false
    const deleteQueueOnClose = this.params.lifecycle?.deleteQueueOnClose ?? false

    await consumer.close()

    // Cleanup is best-effort: already-gone resources (deleted by the reaper,
    // never confirmed by SNS) are treated as success per the QueueLifecycleOptions
    // docstring; only unexpected failures surface via onCleanupError.
    if (
      unsubscribeOnClose &&
      subscriptionArn &&
      subscriptionArn !== PENDING_CONFIRMATION_ARN
    ) {
      try {
        await this.params.dependencies.snsClient.send(
          new UnsubscribeCommand({ SubscriptionArn: subscriptionArn }),
        )
      } catch (err) {
        if (!isSubscriptionNotFound(err)) {
          this.params.lifecycle?.onCleanupError?.(err as Error, 'unsubscribe')
        }
      }
    }
    if (deleteQueueOnClose && queueUrl) {
      try {
        await this.params.dependencies.sqsClient.send(
          new DeleteQueueCommand({ QueueUrl: queueUrl }),
        )
      } catch (err) {
        if (!isQueueNotFound(err)) {
          this.params.lifecycle?.onCleanupError?.(err as Error, 'deleteQueue')
        }
      }
    }
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
