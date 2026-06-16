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
  type BuiltBindings,
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
    const built = buildFlatBindings(
      bindings,
      messageTypeField,
      this.target,
      channel,
      this.errorHandler,
    )

    return new SnsTopicTriggerConsumer(
      this.dependencies,
      buildSnsTriggerConsumerOptions(consumerOptions, built),
      built.context,
    )
  }
}

/**
 * Build the underlying SNS→SQS consumer options for a trigger source.
 *
 * A trigger is not a full consumer: it owns its handlers, its subscription
 * filtering, and its lifecycle. So while the source still supports spreading in
 * a pre-resolved options object — e.g. `@lokalise/aws-config`'s
 * `resolveConsumerOptions(...)` — for `creationConfig`/`locatorConfig`,
 * `deadLetterQueue`, `concurrentConsumersAmount`, `consumerOverrides`, etc., the
 * fields the trigger owns are stripped here rather than left for the caller to
 * un-set at every call site:
 *
 * - **`handlers`** — always rebuilt from `bindings` (the caller's destructure
 *   already drops any spread-in handlers; we re-inject the binding-derived ones).
 * - **subscription filter policy** (`subscriptionConfig.Attributes`) —
 *   `resolveConsumerOptions` derives a `FilterPolicy` from the *consumer's*
 *   handlers. The trigger supplies its own handlers from `bindings`, so the
 *   policy the resolver built (from the empty handler list it was given) would
 *   reject every message. We drop it and default the subscription to accept-all.
 * - **`subscriptionDeadLetterQueue`** — the trigger handles failures through the
 *   queue-level `deadLetterQueue`; a subscription-level redrive policy is
 *   re-applied on every init and conflicts with that, so we drop it. (Not part of
 *   the typed surface, but it can ride along on a spread-in resolved object.)
 */
export function buildSnsTriggerConsumerOptions<TTarget>(
  consumerOptions: SnsTopicSourceConfig,
  built: Pick<BuiltBindings<TTarget>, 'handlers' | 'messageTypeResolver'>,
): SNSSQSConsumerOptions<object, BindingHandlerContext<TTarget>, undefined> {
  const {
    subscriptionConfig,
    subscriptionDeadLetterQueue: _subscriptionDeadLetterQueue,
    ...rest
  } = consumerOptions as SnsTopicSourceConfig & { subscriptionDeadLetterQueue?: unknown }
  const { Attributes: _filterPolicy, ...callerSubscriptionConfig } = subscriptionConfig ?? {}

  return {
    ...rest,
    handlers: built.handlers,
    messageTypeResolver: built.messageTypeResolver,
    subscriptionConfig: { updateAttributesIfExists: false, ...callerSubscriptionConfig },
  } as SNSSQSConsumerOptions<object, BindingHandlerContext<TTarget>, undefined>
}

/** Human-readable channel name derived from an SNS-topic source config. */
export function deriveSnsTopicChannelName(source: SnsTopicInvalidationSource): string {
  if (source.creationConfig?.topic?.Name) return source.creationConfig.topic.Name
  if (source.locatorConfig?.topicName) return source.locatorConfig.topicName
  if (source.locatorConfig?.topicArn) return source.locatorConfig.topicArn
  if (source.locatorConfig?.queueUrl) return source.locatorConfig.queueUrl
  return 'sns-invalidation-trigger'
}
