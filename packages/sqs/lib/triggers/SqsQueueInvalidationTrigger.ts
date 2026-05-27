import type {
  SQSConsumerDependencies,
  SQSConsumerOptions,
  SQSCreationConfig,
  SQSQueueLocatorType,
} from '@message-queue-toolkit/sqs'
import {
  AbstractSqsTrigger,
  type InternalConsumerHandle,
  SqsQueueTriggerConsumer,
} from './AbstractSqsTrigger.js'
import {
  type BindingHandlerContext,
  buildFlatBindings,
  type FlatBinding,
} from './bindingHelpers.js'
import type { InvalidationTarget, TriggerErrorHandler } from './types.js'

export type SqsQueueSourceConfig =
  | { creationConfig: SQSCreationConfig; locatorConfig?: never }
  | { creationConfig?: never; locatorConfig: SQSQueueLocatorType }

export type SqsQueueInvalidationSource = SqsQueueSourceConfig & {
  /**
   * Path on the message body whose value selects which binding handles each
   * message. Required when `bindings` has more than one entry; ignored
   * otherwise.
   */
  messageTypeField?: string
  // biome-ignore lint/suspicious/noExplicitAny: bindings heterogeneous over TMessage
  bindings: readonly FlatBinding<any>[]
}

export type SqsQueueInvalidationTriggerParams = {
  /**
   * Where resolved invalidations are applied. A `Loader` satisfies this
   * structurally — its invalidation methods already handle the local
   * in-memory cache, the async cache, and (if configured) the notification
   * publisher that fans out to peer instances.
   */
  target: InvalidationTarget
  /**
   * Shared AWS dependencies (SQS client, logger, error reporter, etc.) used
   * to build the underlying consumers. One block per trigger — every source
   * reuses it.
   */
  dependencies: SQSConsumerDependencies
  /** One or more SQS queues to consume from. */
  sources: readonly SqsQueueInvalidationSource[]
  errorHandler?: TriggerErrorHandler
  /** Logical channel name passed to {@link errorHandler}. Defaults to a derived value. */
  channel?: string
}

/**
 * Invalidation trigger consuming directly from SQS queues that already exist
 * upstream (no SNS topic in the middle). Subscribes to N queues, applies
 * resolved invalidations to a `Loader`, and lets the loader's notification
 * publisher fan them out to peer instances.
 */
export class SqsQueueInvalidationTrigger extends AbstractSqsTrigger {
  private readonly target: InvalidationTarget
  private readonly dependencies: SQSConsumerDependencies
  private readonly sources: readonly SqsQueueInvalidationSource[]
  private readonly errorHandler: TriggerErrorHandler | undefined
  private readonly channelOverride: string | undefined

  constructor(params: SqsQueueInvalidationTriggerParams) {
    super()
    if (params.sources.length === 0) {
      throw new Error('SqsQueueInvalidationTrigger requires at least one source')
    }
    this.target = params.target
    this.dependencies = params.dependencies
    this.sources = params.sources
    this.errorHandler = params.errorHandler
    this.channelOverride = params.channel
  }

  protected createConsumers(): readonly InternalConsumerHandle[] {
    return this.sources.map((source) => this.buildConsumer(source))
  }

  private buildConsumer(source: SqsQueueInvalidationSource): InternalConsumerHandle {
    const channel = this.channelOverride ?? deriveSqsQueueChannelName(source)
    const { handlers, context, messageTypeResolver } = buildFlatBindings(
      source.bindings,
      source.messageTypeField,
      this.target,
      channel,
      this.errorHandler,
    )

    const base = { handlers, messageTypeResolver }
    const options = source.creationConfig
      ? { ...base, creationConfig: source.creationConfig }
      : { ...base, locatorConfig: source.locatorConfig }

    return new SqsQueueTriggerConsumer(
      this.dependencies,
      options as SQSConsumerOptions<object, BindingHandlerContext<InvalidationTarget>, undefined>,
      context,
    )
  }
}

/** Human-readable channel name derived from an SQS-queue source config. */
export function deriveSqsQueueChannelName(source: SqsQueueInvalidationSource): string {
  if (source.creationConfig?.queue?.QueueName) return source.creationConfig.queue.QueueName
  if (source.locatorConfig?.queueName) return source.locatorConfig.queueName
  if (source.locatorConfig?.queueUrl) return source.locatorConfig.queueUrl
  return 'sqs-invalidation-trigger'
}
