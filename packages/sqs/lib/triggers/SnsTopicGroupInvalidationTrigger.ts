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
  buildGroupBindings,
  type GroupBinding,
} from './bindingHelpers.js'
import type { GroupInvalidationTarget, TriggerErrorHandler } from './types.js'

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
export type SnsTopicGroupSourceConfig = Omit<
  SNSSQSConsumerOptions<object, BindingHandlerContext<GroupInvalidationTarget>, undefined>,
  'handlers'
>

export type SnsTopicGroupInvalidationSource = SnsTopicGroupSourceConfig & {
  messageTypeField?: string
  // biome-ignore lint/suspicious/noExplicitAny: bindings heterogeneous over TMessage
  bindings: readonly GroupBinding<any>[]
}

export type SnsTopicGroupInvalidationTriggerParams = {
  target: GroupInvalidationTarget
  dependencies: SNSSQSConsumerDependencies
  sources: readonly SnsTopicGroupInvalidationSource[]
  errorHandler?: TriggerErrorHandler
  channel?: string
}

export class SnsTopicGroupInvalidationTrigger extends AbstractSqsTrigger {
  private readonly target: GroupInvalidationTarget
  private readonly dependencies: SNSSQSConsumerDependencies
  private readonly sources: readonly SnsTopicGroupInvalidationSource[]
  private readonly errorHandler: TriggerErrorHandler | undefined
  private readonly channelOverride: string | undefined

  constructor(params: SnsTopicGroupInvalidationTriggerParams) {
    super()
    if (params.sources.length === 0) {
      throw new Error('SnsTopicGroupInvalidationTrigger requires at least one source')
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

  private buildConsumer(source: SnsTopicGroupInvalidationSource): InternalConsumerHandle {
    const channel = this.channelOverride ?? deriveSnsTopicGroupChannelName(source)
    const { bindings, messageTypeField, ...consumerOptions } = source
    const { handlers, context, messageTypeResolver } = buildGroupBindings(
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
        BindingHandlerContext<GroupInvalidationTarget>,
        undefined
      >,
      context,
    )
  }
}

export function deriveSnsTopicGroupChannelName(source: SnsTopicGroupInvalidationSource): string {
  if (source.creationConfig?.topic?.Name) return source.creationConfig.topic.Name
  if (source.locatorConfig?.topicName) return source.locatorConfig.topicName
  if (source.locatorConfig?.topicArn) return source.locatorConfig.topicArn
  if (source.locatorConfig?.queueUrl) return source.locatorConfig.queueUrl
  return 'sns-group-invalidation-trigger'
}
