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
import type { GroupNotificationPublisher } from 'layered-loader'
import type { ZodSchema } from 'zod'
import { runGroupPipeline } from './dispatch.js'
import type { TriggerSubscriptionOptions } from './SqsInvalidationTrigger.js'
import type {
  GroupInvalidationAction,
  InvalidationResolver,
  InvalidationTrigger,
  TriggerErrorHandler,
} from './types.js'

const GROUP_TRIGGER_MESSAGE_TYPE = 'layered-loader.group-invalidation-trigger'

export type SqsGroupTriggerSourceConfig =
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

export type SqsGroupInvalidationTriggerParams<TMessage extends object> = {
  messageSchema: ZodSchema<TMessage>
  resolver: InvalidationResolver<TMessage, GroupInvalidationAction>
  /**
   * The group notification publisher that propagates invalidation.
   *
   * Pass a publisher whose server UUID is distinct from any Loader's
   * notification pair — otherwise the local pair's consumer treats trigger
   * messages as self-emitted and drops them, leaving the local cache stale.
   */
  publisher: GroupNotificationPublisher<unknown>
  errorHandler?: TriggerErrorHandler
  channel?: string
} & SqsGroupTriggerSourceConfig

interface InternalConsumer {
  init(): Promise<void>
  start(): Promise<void>
  close(abort?: boolean): Promise<void>
}

type TriggerExecutionContext<TMessage> = {
  resolver: InvalidationResolver<TMessage, GroupInvalidationAction>
  publisher: GroupNotificationPublisher<unknown>
  channel: string
  errorHandler: TriggerErrorHandler | undefined
}

class SqsQueueGroupTriggerConsumer<TMessage extends object> extends AbstractSqsConsumer<
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

class SnsTopicGroupTriggerConsumer<TMessage extends object> extends AbstractSnsSqsConsumer<
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

export class SqsGroupInvalidationTrigger<TMessage extends object> implements InvalidationTrigger {
  private readonly params: SqsGroupInvalidationTriggerParams<TMessage>
  private readonly channel: string
  private internalConsumer?: InternalConsumer

  constructor(params: SqsGroupInvalidationTriggerParams<TMessage>) {
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
        await runGroupPipeline(message, ctx.resolver, ctx.publisher)
        return { result: 'success' as const }
      } catch (err) {
        ctx.errorHandler?.(err as Error, ctx.channel)
        throw err
      }
    }

    const handlers = new MessageHandlerConfigBuilder<TMessage, TriggerExecutionContext<TMessage>>()
      .addConfig(this.params.messageSchema, handler, { messageType: GROUP_TRIGGER_MESSAGE_TYPE })
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
        messageTypeResolver: { literal: GROUP_TRIGGER_MESSAGE_TYPE },
        ...(this.params.creationConfig
          ? { creationConfig: this.params.creationConfig }
          : { locatorConfig: this.params.locatorConfig }),
      }
      return new SqsQueueGroupTriggerConsumer(this.params.dependencies, options, context)
    }

    const options = {
      handlers,
      messageTypeResolver: { literal: GROUP_TRIGGER_MESSAGE_TYPE },
      subscriptionConfig: this.params.subscriptionConfig ?? { updateAttributesIfExists: false },
      ...(this.params.creationConfig
        ? { creationConfig: this.params.creationConfig }
        : { locatorConfig: this.params.locatorConfig }),
    } as SNSSQSConsumerOptions<TMessage, TriggerExecutionContext<TMessage>, undefined>
    return new SnsTopicGroupTriggerConsumer(this.params.dependencies, options, context)
  }
}

function deriveChannelName<TMessage extends object>(
  params: SqsGroupInvalidationTriggerParams<TMessage>,
): string {
  if (params.sourceType === 'sqs-queue') {
    if (params.creationConfig?.queue?.QueueName) return params.creationConfig.queue.QueueName
    if (params.locatorConfig?.queueName) return params.locatorConfig.queueName
    if (params.locatorConfig?.queueUrl) return params.locatorConfig.queueUrl
    return 'sqs-group-invalidation-trigger'
  }
  if (params.creationConfig?.topic?.Name) return params.creationConfig.topic.Name
  if (params.locatorConfig?.topicName) return params.locatorConfig.topicName
  if (params.locatorConfig?.topicArn) return params.locatorConfig.topicArn
  if (params.locatorConfig?.queueUrl) return params.locatorConfig.queueUrl
  return 'sns-group-invalidation-trigger'
}
