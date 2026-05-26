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
  buildGroupBindings,
  type GroupBinding,
} from './bindingHelpers.js'
import type { GroupInvalidationTarget, TriggerErrorHandler } from './types.js'

export type SnsTopicGroupSourceConfig =
  | { creationConfig: SNSSQSCreationConfig; locatorConfig?: never }
  | { creationConfig?: never; locatorConfig: SNSSQSQueueLocatorType }

export type SnsTopicGroupInvalidationSource = SnsTopicGroupSourceConfig & {
  subscriptionConfig?: SqsSubscriptionOptions
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
    const { handlers, context, messageTypeResolver } = buildGroupBindings(
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
