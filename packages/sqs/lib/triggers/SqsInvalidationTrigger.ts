import type { SubscribeCommandInput } from '@aws-sdk/client-sns'
import { MessageHandlerConfigBuilder } from '@message-queue-toolkit/core'
import {
  AbstractSnsSqsConsumer,
  type SNSSQSConsumerDependencies,
  type SNSSQSConsumerOptions,
  type SNSSQSCreationConfig,
  type SNSSQSQueueLocatorType,
} from '@message-queue-toolkit/sns'
import {
  AbstractSqsConsumer,
  type SQSConsumerDependencies,
  type SQSConsumerOptions,
  type SQSCreationConfig,
  type SQSQueueLocatorType,
} from '@message-queue-toolkit/sqs'
import type { NotificationPublisher } from 'layered-loader'
import type { ZodSchema } from 'zod'
import { runFlatPipeline } from './dispatch.js'
import type {
  InvalidationAction,
  InvalidationResolver,
  InvalidationTrigger,
  TriggerErrorHandler,
} from './types.js'

const TRIGGER_MESSAGE_TYPE = 'layered-loader.invalidation-trigger'

/** Mirror of `SNSSubscriptionOptions` (not re-exported by the upstream package). */
export type TriggerSubscriptionOptions = Omit<
  SubscribeCommandInput,
  'TopicArn' | 'Endpoint' | 'Protocol' | 'ReturnSubscriptionArn'
> & {
  updateAttributesIfExists: boolean
}

export type SqsTriggerSourceConfig =
  | {
      sourceType: 'sqs-queue'
      dependencies: SQSConsumerDependencies
      creationConfig: SQSCreationConfig
      locatorConfig?: never
    }
  | {
      sourceType: 'sqs-queue'
      dependencies: SQSConsumerDependencies
      creationConfig?: never
      locatorConfig: SQSQueueLocatorType
    }
  | {
      sourceType: 'sns-topic'
      dependencies: SNSSQSConsumerDependencies
      creationConfig: SNSSQSCreationConfig
      locatorConfig?: never
      subscriptionConfig?: TriggerSubscriptionOptions
    }
  | {
      sourceType: 'sns-topic'
      dependencies: SNSSQSConsumerDependencies
      creationConfig?: never
      locatorConfig: SNSSQSQueueLocatorType
      subscriptionConfig?: TriggerSubscriptionOptions
    }

export type SqsInvalidationTriggerParams<TMessage extends object> = {
  /**
   * Schema validating each message body delivered by the upstream transport.
   * The resolver receives the validated `TMessage`. Use `z.unknown()` (or a
   * permissive object schema) to accept arbitrary payloads.
   */
  messageSchema: ZodSchema<TMessage>
  resolver: InvalidationResolver<TMessage, InvalidationAction>
  /**
   * The notification publisher that propagates invalidation across the cache
   * cluster.
   *
   * **Important**: a trigger publishes invalidations on behalf of an external
   * domain event, not on behalf of any local Loader. Pass a publisher that has
   * its own server UUID (distinct from any Loader's notification pair),
   * otherwise the local pair's consumer will treat the trigger's messages as
   * self-emitted and drop them — leaving the local in-memory cache stale.
   *
   * Construct one with:
   * ```
   * const triggerPublisher = new SqsNotificationPublisher({
   *   serverUuid: randomUUID(),
   *   dependencies, locatorConfig: { topicName: 'app-invalidations' },
   * })
   * ```
   */
  publisher: NotificationPublisher<unknown>
  errorHandler?: TriggerErrorHandler
  /** Logical channel name passed to {@link errorHandler}. Defaults to a derived value. */
  channel?: string
} & SqsTriggerSourceConfig

interface InternalConsumer {
  init(): Promise<void>
  start(): Promise<void>
  close(abort?: boolean): Promise<void>
}

class SqsQueueTriggerConsumer<TMessage extends object> extends AbstractSqsConsumer<
  TMessage,
  TriggerExecutionContext<TMessage>
> {
  constructor(
    dependencies: SQSConsumerDependencies,
    options: SQSConsumerOptions<TMessage, TriggerExecutionContext<TMessage>, undefined>,
    context: TriggerExecutionContext<TMessage>,
  ) {
    super(dependencies, options, context)
  }
}

class SnsTopicTriggerConsumer<TMessage extends object> extends AbstractSnsSqsConsumer<
  TMessage,
  TriggerExecutionContext<TMessage>
> {
  constructor(
    dependencies: SNSSQSConsumerDependencies,
    options: SNSSQSConsumerOptions<TMessage, TriggerExecutionContext<TMessage>, undefined>,
    context: TriggerExecutionContext<TMessage>,
  ) {
    super(dependencies, options, context)
  }
}

type TriggerExecutionContext<TMessage> = {
  resolver: InvalidationResolver<TMessage, InvalidationAction>
  publisher: NotificationPublisher<unknown>
  channel: string
  errorHandler: TriggerErrorHandler | undefined
}

export class SqsInvalidationTrigger<TMessage extends object> implements InvalidationTrigger {
  private readonly params: SqsInvalidationTriggerParams<TMessage>
  private readonly channel: string
  private internalConsumer?: InternalConsumer

  constructor(params: SqsInvalidationTriggerParams<TMessage>) {
    this.params = params
    this.channel = params.channel ?? deriveChannelName(params)
  }

  async start(): Promise<void> {
    if (this.internalConsumer) return
    this.internalConsumer = this.buildConsumer()
    await this.internalConsumer.init()
    await this.internalConsumer.start()
  }

  async stop(): Promise<void> {
    const consumer = this.internalConsumer
    if (!consumer) return
    this.internalConsumer = undefined
    await consumer.close()
  }

  private buildConsumer(): InternalConsumer {
    const handler = async (message: TMessage, ctx: TriggerExecutionContext<TMessage>) => {
      try {
        await runFlatPipeline(message, ctx.resolver, ctx.publisher)
        return { result: 'success' as const }
      } catch (err) {
        ctx.errorHandler?.(err as Error, ctx.channel)
        // Re-throw so message-queue-toolkit's standard retry/DLQ flow takes over.
        throw err
      }
    }

    const handlers = new MessageHandlerConfigBuilder<TMessage, TriggerExecutionContext<TMessage>>()
      .addConfig(this.params.messageSchema, handler, { messageType: TRIGGER_MESSAGE_TYPE })
      .build()

    const context: TriggerExecutionContext<TMessage> = {
      resolver: this.params.resolver,
      publisher: this.params.publisher,
      channel: this.channel,
      errorHandler: this.params.errorHandler,
    }

    if (this.params.sourceType === 'sqs-queue') {
      const options: SQSConsumerOptions<TMessage, TriggerExecutionContext<TMessage>, undefined> = {
        handlers,
        messageTypeResolver: { literal: TRIGGER_MESSAGE_TYPE },
        ...(this.params.creationConfig
          ? { creationConfig: this.params.creationConfig }
          : { locatorConfig: this.params.locatorConfig }),
      }
      return new SqsQueueTriggerConsumer(this.params.dependencies, options, context)
    }

    const options = {
      handlers,
      messageTypeResolver: { literal: TRIGGER_MESSAGE_TYPE },
      subscriptionConfig: this.params.subscriptionConfig ?? { updateAttributesIfExists: false },
      ...(this.params.creationConfig
        ? { creationConfig: this.params.creationConfig }
        : { locatorConfig: this.params.locatorConfig }),
    } as SNSSQSConsumerOptions<TMessage, TriggerExecutionContext<TMessage>, undefined>
    return new SnsTopicTriggerConsumer(this.params.dependencies, options, context)
  }
}

function deriveChannelName<TMessage extends object>(
  params: SqsInvalidationTriggerParams<TMessage>,
): string {
  if (params.sourceType === 'sqs-queue') {
    if (params.creationConfig?.queue?.QueueName) return params.creationConfig.queue.QueueName
    if (params.locatorConfig?.queueName) return params.locatorConfig.queueName
    if (params.locatorConfig?.queueUrl) return params.locatorConfig.queueUrl
    return 'sqs-invalidation-trigger'
  }
  if (params.creationConfig?.topic?.Name) return params.creationConfig.topic.Name
  if (params.locatorConfig?.topicName) return params.locatorConfig.topicName
  if (params.locatorConfig?.topicArn) return params.locatorConfig.topicArn
  if (params.locatorConfig?.queueUrl) return params.locatorConfig.queueUrl
  return 'sns-invalidation-trigger'
}
