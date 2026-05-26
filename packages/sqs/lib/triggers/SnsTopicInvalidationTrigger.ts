import type {
  SNSSQSConsumerDependencies,
  SNSSQSConsumerOptions,
  SNSSQSCreationConfig,
  SNSSQSQueueLocatorType,
} from '@message-queue-toolkit/sns'
import type { SqsSubscriptionOptions } from '../SqsNotificationConsumer.js'
import {
  AbstractSqsTrigger,
  type InternalConsumerHandle,
  SnsTopicTriggerConsumer,
} from './AbstractSqsTrigger.js'
import {
  type BindingHandlerContext,
  buildFlatBindings,
  type FlatBinding,
} from './bindingHelpers.js'
import type { InvalidationTarget, TriggerErrorHandler } from './types.js'

export type SnsTopicSourceConfig =
  | { creationConfig: SNSSQSCreationConfig; locatorConfig?: never }
  | { creationConfig?: never; locatorConfig: SNSSQSQueueLocatorType }

export type SnsTopicInvalidationSource = SnsTopicSourceConfig & {
  subscriptionConfig?: SqsSubscriptionOptions
  messageTypeField?: string
  // biome-ignore lint/suspicious/noExplicitAny: bindings heterogeneous over TMessage
  bindings: readonly FlatBinding<any>[]
}

export type SnsTopicInvalidationTriggerParams = {
  target: InvalidationTarget
  /**
   * Shared AWS dependencies for every source. Includes the SNS, SQS and STS
   * clients required to subscribe to upstream topics.
   */
  dependencies: SNSSQSConsumerDependencies
  sources: readonly SnsTopicInvalidationSource[]
  errorHandler?: TriggerErrorHandler
  channel?: string
}

/**
 * Invalidation trigger that subscribes a dedicated SQS queue to each upstream
 * SNS topic and routes the resulting messages through resolvers into a flat
 * `Loader`.
 */
export class SnsTopicInvalidationTrigger extends AbstractSqsTrigger {
  private readonly target: InvalidationTarget
  private readonly dependencies: SNSSQSConsumerDependencies
  private readonly sources: readonly SnsTopicInvalidationSource[]
  private readonly errorHandler: TriggerErrorHandler | undefined
  private readonly channelOverride: string | undefined

  constructor(params: SnsTopicInvalidationTriggerParams) {
    super()
    if (params.sources.length === 0) {
      throw new Error('SnsTopicInvalidationTrigger requires at least one source')
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

  private buildConsumer(source: SnsTopicInvalidationSource): InternalConsumerHandle {
    const channel = this.channelOverride ?? deriveSnsTopicChannelName(source)
    const { handlers, context, messageTypeResolver } = buildFlatBindings(
      source.bindings,
      source.messageTypeField,
      this.target,
      channel,
      this.errorHandler,
    )

    const base = {
      handlers,
      messageTypeResolver,
      subscriptionConfig: source.subscriptionConfig ?? { updateAttributesIfExists: false },
    }
    const options = source.creationConfig
      ? { ...base, creationConfig: source.creationConfig }
      : { ...base, locatorConfig: source.locatorConfig }

    return new SnsTopicTriggerConsumer(
      this.dependencies,
      options as SNSSQSConsumerOptions<
        object,
        BindingHandlerContext<InvalidationTarget>,
        undefined
      >,
      context,
    )
  }
}

/** Human-readable channel name derived from an SNS-topic source config. */
export function deriveSnsTopicChannelName(source: SnsTopicInvalidationSource): string {
  if (source.creationConfig?.topic?.Name) return source.creationConfig.topic.Name
  if (source.locatorConfig?.topicName) return source.locatorConfig.topicName
  if (source.locatorConfig?.topicArn) return source.locatorConfig.topicArn
  if (source.locatorConfig?.queueUrl) return source.locatorConfig.queueUrl
  return 'sns-invalidation-trigger'
}
