import { type MessageHandlerConfig, MessageHandlerConfigBuilder } from '@message-queue-toolkit/core'
import type { GroupNotificationPublisher } from 'layered-loader'
import type { ZodSchema } from 'zod'
import {
  AbstractSqsTrigger,
  deriveTriggerChannelName,
  type SqsTriggerSource,
} from './AbstractSqsTrigger.js'
import { runGroupPipeline } from './dispatch.js'
import type {
  GroupInvalidationAction,
  InvalidationResolver,
  TriggerErrorHandler,
} from './types.js'

const GROUP_TRIGGER_MESSAGE_TYPE = 'layered-loader.group-invalidation-trigger'

export type SqsGroupTriggerSourceConfig = SqsTriggerSource

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

type GroupTriggerContext<TMessage> = {
  resolver: InvalidationResolver<TMessage, GroupInvalidationAction>
  publisher: GroupNotificationPublisher<unknown>
  channel: string
  errorHandler: TriggerErrorHandler | undefined
}

export class SqsGroupInvalidationTrigger<TMessage extends object> extends AbstractSqsTrigger<
  TMessage,
  GroupTriggerContext<TMessage>
> {
  protected readonly source: SqsTriggerSource
  protected readonly messageType = GROUP_TRIGGER_MESSAGE_TYPE
  protected readonly channel: string

  private readonly messageSchema: ZodSchema<TMessage>
  private readonly resolver: InvalidationResolver<TMessage, GroupInvalidationAction>
  private readonly publisher: GroupNotificationPublisher<unknown>
  private readonly errorHandler: TriggerErrorHandler | undefined

  constructor(params: SqsGroupInvalidationTriggerParams<TMessage>) {
    super()
    const { messageSchema, resolver, publisher, errorHandler, channel, ...source } = params
    this.source = source as SqsTriggerSource
    this.messageSchema = messageSchema
    this.resolver = resolver
    this.publisher = publisher
    this.errorHandler = errorHandler
    this.channel = channel ?? deriveTriggerChannelName(this.source)
  }

  protected buildContext(): GroupTriggerContext<TMessage> {
    return {
      resolver: this.resolver,
      publisher: this.publisher,
      channel: this.channel,
      errorHandler: this.errorHandler,
    }
  }

  protected buildHandlers(): MessageHandlerConfig<
    TMessage,
    GroupTriggerContext<TMessage>,
    undefined
  >[] {
    return new MessageHandlerConfigBuilder<TMessage, GroupTriggerContext<TMessage>>()
      .addConfig(
        this.messageSchema,
        async (message, ctx) => {
          try {
            await runGroupPipeline(message, ctx.resolver, ctx.publisher)
            return { result: 'success' as const }
          } catch (err) {
            ctx.errorHandler?.(err as Error, ctx.channel)
            throw err
          }
        },
        { messageType: GROUP_TRIGGER_MESSAGE_TYPE },
      )
      .build()
  }
}
