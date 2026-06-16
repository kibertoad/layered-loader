import type {
  SQSConsumerDependencies,
  SQSConsumerOptions,
} from '@message-queue-toolkit/sqs'
import {
  AbstractSqsTrigger,
  type InternalConsumerHandle,
  SqsQueueTriggerConsumer,
} from './AbstractSqsTrigger.js'
import {
  type BindingHandlerContext,
  buildGroupBindings,
  type GroupBinding,
} from './bindingHelpers.js'
import type { SqsQueueSourceConfig } from './SqsQueueInvalidationTrigger.js'
import type { GroupInvalidationTarget, TriggerErrorHandler } from './types.js'

/**
 * The per-source config surface is identical to the flat-cache one — every
 * `message-queue-toolkit` SQS consumer option minus `handlers` — so it is
 * aliased to {@link SqsQueueSourceConfig} rather than re-declared. The handler
 * execution context (the only place the two would differ) lives on the omitted
 * `handlers` field, so the resulting types are structurally the same.
 */
export type SqsQueueGroupSourceConfig = SqsQueueSourceConfig

export type SqsQueueGroupInvalidationSource = SqsQueueGroupSourceConfig & {
  messageTypeField?: string
  // biome-ignore lint/suspicious/noExplicitAny: bindings heterogeneous over TMessage
  bindings: readonly GroupBinding<any>[]
}

export type SqsQueueGroupInvalidationTriggerParams = {
  target: GroupInvalidationTarget
  dependencies: SQSConsumerDependencies
  sources: readonly SqsQueueGroupInvalidationSource[]
  errorHandler?: TriggerErrorHandler
  channel?: string
}

export class SqsQueueGroupInvalidationTrigger extends AbstractSqsTrigger {
  private readonly target: GroupInvalidationTarget
  private readonly dependencies: SQSConsumerDependencies
  private readonly sources: readonly SqsQueueGroupInvalidationSource[]
  private readonly errorHandler: TriggerErrorHandler | undefined
  private readonly channelOverride: string | undefined

  constructor(params: SqsQueueGroupInvalidationTriggerParams) {
    super()
    if (params.sources.length === 0) {
      throw new Error('SqsQueueGroupInvalidationTrigger requires at least one source')
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

  private buildConsumer(source: SqsQueueGroupInvalidationSource): InternalConsumerHandle {
    const channel = this.channelOverride ?? deriveSqsQueueGroupChannelName(source)
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
    const options = { ...consumerOptions, handlers, messageTypeResolver }

    return new SqsQueueTriggerConsumer(
      this.dependencies,
      options as SQSConsumerOptions<
        object,
        BindingHandlerContext<GroupInvalidationTarget>,
        undefined
      >,
      context,
    )
  }
}

export function deriveSqsQueueGroupChannelName(source: SqsQueueGroupInvalidationSource): string {
  if (source.creationConfig?.queue?.QueueName) return source.creationConfig.queue.QueueName
  if (source.locatorConfig?.queueName) return source.locatorConfig.queueName
  if (source.locatorConfig?.queueUrl) return source.locatorConfig.queueUrl
  return 'sqs-group-invalidation-trigger'
}
