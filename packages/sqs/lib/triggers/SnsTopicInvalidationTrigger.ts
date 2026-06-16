import type {
  SNSSQSConsumerDependencies,
  SNSSQSConsumerOptions,
} from '@message-queue-toolkit/sns'
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

/**
 * Every option the underlying `message-queue-toolkit` SNS→SQS consumer accepts,
 * minus the `handlers` list (which the trigger builds from `bindings`).
 *
 * This is the per-source config surface, so callers get the same flexibility in
 * two interchangeable styles, both fully type-checked:
 *
 * - **Explicit** — spell out `creationConfig`/`locatorConfig`, `subscriptionConfig`,
 *   `deadLetterQueue`, `concurrentConsumersAmount`, etc. with autocomplete and
 *   typo detection.
 * - **Spread** — drop in a pre-resolved options object (e.g.
 *   `@lokalise/aws-config`'s `resolveConsumerOptions(...)`) with `...options`.
 */
export type SnsTopicSourceConfig = Omit<
  SNSSQSConsumerOptions<object, BindingHandlerContext<InvalidationTarget>, undefined>,
  'handlers'
>

export type SnsTopicInvalidationSource = SnsTopicSourceConfig & {
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
    const { bindings, messageTypeField, ...consumerOptions } = source
    const { handlers, context, messageTypeResolver } = buildFlatBindings(
      bindings,
      messageTypeField,
      this.target,
      channel,
      this.errorHandler,
    )

    // Forward every consumer option the caller supplied. This deliberately
    // spreads the whole source (minus the trigger-only `bindings`/
    // `messageTypeField`) so a pre-resolved options object — e.g. the output of
    // `@lokalise/aws-config`'s `resolveConsumerOptions(...)` — can be spread
    // straight into the source and have all of its fields (`creationConfig`/
    // `locatorConfig`, `deadLetterQueue`, `concurrentConsumersAmount`,
    // `consumerOverrides`, ...) flow through untouched. The trigger owns
    // `handlers`, so the bindings-derived handlers always override any in the
    // spread.
    const options = {
      ...consumerOptions,
      handlers,
      messageTypeResolver,
      subscriptionConfig: source.subscriptionConfig ?? { updateAttributesIfExists: false },
    }

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
