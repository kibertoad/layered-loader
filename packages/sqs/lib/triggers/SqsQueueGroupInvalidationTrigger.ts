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
  buildGroupBindings,
  type GroupBinding,
} from './bindingHelpers.js'
import type { GroupInvalidationTarget, TriggerErrorHandler } from './types.js'

export type SqsQueueGroupSourceConfig =
  | { creationConfig: SQSCreationConfig; locatorConfig?: never }
  | { creationConfig?: never; locatorConfig: SQSQueueLocatorType }

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
    const { handlers, context, messageTypeResolver } = buildGroupBindings(
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
