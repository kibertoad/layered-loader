import type { MessageHandlerConfig } from '@message-queue-toolkit/core'
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
import type { SqsSubscriptionOptions } from '../SqsNotificationConsumer.js'
import type { InvalidationTrigger } from './types.js'

/**
 * Discriminated source config shared by every SQS-based trigger
 * (flat or group, current and future variants).
 */
export type SqsTriggerSource =
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
      subscriptionConfig?: SqsSubscriptionOptions
    }
  | {
      sourceType: 'sns-topic'
      dependencies: SNSSQSConsumerDependencies
      creationConfig?: never
      locatorConfig: SNSSQSQueueLocatorType
      subscriptionConfig?: SqsSubscriptionOptions
    }

/** Minimal lifecycle slice we need from the underlying message-queue-toolkit consumer. */
export interface InternalConsumerHandle {
  init(): Promise<void>
  start(): Promise<void>
  close(abort?: boolean): Promise<void>
}

/**
 * Concrete subclasses of `AbstractSnsSqsConsumer` / `AbstractSqsConsumer` are
 * needed because the upstream classes are abstract. They add no behaviour;
 * they just expose the constructor.
 */
class SqsQueueTriggerConsumer<TMessage extends object, TContext> extends AbstractSqsConsumer<
  TMessage,
  TContext
> {
  constructor(
    dependencies: SQSConsumerDependencies,
    options: SQSConsumerOptions<TMessage, TContext, undefined>,
    context: TContext,
  ) {
    super(dependencies, options, context)
  }
}

class SnsTopicTriggerConsumer<TMessage extends object, TContext> extends AbstractSnsSqsConsumer<
  TMessage,
  TContext
> {
  constructor(
    dependencies: SNSSQSConsumerDependencies,
    options: SNSSQSConsumerOptions<TMessage, TContext, undefined>,
    context: TContext,
  ) {
    super(dependencies, options, context)
  }
}

/**
 * Shared lifecycle (start/stop with idempotency + concurrent-call protection)
 * and consumer construction logic for SQS-based triggers. Subclasses provide
 * the concrete handler configuration via {@link buildHandlers}.
 */
export abstract class AbstractSqsTrigger<TMessage extends object, TContext>
  implements InvalidationTrigger
{
  private internalConsumer?: InternalConsumerHandle
  private startPromise?: Promise<void>

  protected abstract readonly source: SqsTriggerSource
  protected abstract readonly messageType: string
  protected abstract readonly channel: string

  /** Build the handler configuration for the underlying consumer. */
  protected abstract buildHandlers(): MessageHandlerConfig<TMessage, TContext, undefined>[]

  /** Construct the per-trigger execution context that handlers receive. */
  protected abstract buildContext(): TContext

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    if (this.internalConsumer) return
    this.startPromise = (async () => {
      const consumer = this.createConsumer()
      try {
        await consumer.init()
        await consumer.start()
        this.internalConsumer = consumer
      } finally {
        this.startPromise = undefined
      }
    })()
    return this.startPromise
  }

  async stop(): Promise<void> {
    // Wait for any in-flight start to settle so we don't leak a consumer.
    if (this.startPromise) {
      await this.startPromise.catch(() => undefined)
    }
    const consumer = this.internalConsumer
    if (!consumer) return
    this.internalConsumer = undefined
    await consumer.close()
  }

  private createConsumer(): InternalConsumerHandle {
    const handlers = this.buildHandlers()
    const context = this.buildContext()
    const messageTypeResolver = { literal: this.messageType }

    if (this.source.sourceType === 'sqs-queue') {
      const base = {
        handlers,
        messageTypeResolver,
      }
      const options: SQSConsumerOptions<TMessage, TContext, undefined> = this.source.creationConfig
        ? { ...base, creationConfig: this.source.creationConfig }
        : { ...base, locatorConfig: this.source.locatorConfig }
      return new SqsQueueTriggerConsumer<TMessage, TContext>(
        this.source.dependencies,
        options,
        context,
      )
    }

    const base = {
      handlers,
      messageTypeResolver,
      subscriptionConfig: this.source.subscriptionConfig ?? { updateAttributesIfExists: false },
    }
    const options: SNSSQSConsumerOptions<TMessage, TContext, undefined> = this.source.creationConfig
      ? { ...base, creationConfig: this.source.creationConfig }
      : { ...base, locatorConfig: this.source.locatorConfig }
    return new SnsTopicTriggerConsumer<TMessage, TContext>(
      this.source.dependencies,
      options,
      context,
    )
  }
}

/**
 * Derive a human-readable channel name from any {@link SqsTriggerSource} for
 * use in error messages and logging.
 */
export function deriveTriggerChannelName(source: SqsTriggerSource): string {
  if (source.sourceType === 'sqs-queue') {
    if (source.creationConfig?.queue?.QueueName) return source.creationConfig.queue.QueueName
    if (source.locatorConfig?.queueName) return source.locatorConfig.queueName
    if (source.locatorConfig?.queueUrl) return source.locatorConfig.queueUrl
    return 'sqs-invalidation-trigger'
  }
  if (source.creationConfig?.topic?.Name) return source.creationConfig.topic.Name
  if (source.locatorConfig?.topicName) return source.locatorConfig.topicName
  if (source.locatorConfig?.topicArn) return source.locatorConfig.topicArn
  if (source.locatorConfig?.queueUrl) return source.locatorConfig.queueUrl
  return 'sns-invalidation-trigger'
}
