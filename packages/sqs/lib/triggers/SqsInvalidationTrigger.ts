import { type MessageHandlerConfig, MessageHandlerConfigBuilder } from '@message-queue-toolkit/core'
import type { NotificationPublisher } from 'layered-loader'
import type { ZodSchema } from 'zod'
import {
  AbstractSqsTrigger,
  deriveTriggerChannelName,
  type SqsTriggerSource,
} from './AbstractSqsTrigger.js'
import { runFlatPipeline } from './dispatch.js'
import type {
  InvalidationAction,
  InvalidationResolver,
  TriggerErrorHandler,
} from './types.js'

const TRIGGER_MESSAGE_TYPE = 'layered-loader.invalidation-trigger'

export type SqsTriggerSourceConfig = SqsTriggerSource

export type SqsInvalidationTriggerParams<TMessage extends object> = {
  /**
   * Schema validating each message body delivered by the upstream transport.
   * The resolver receives the validated `TMessage`. Use `z.unknown()` (or a
   * permissive object schema) to accept arbitrary payloads.
   */
  messageSchema: ZodSchema<TMessage>
  resolver: InvalidationResolver<TMessage, InvalidationAction>
  /**
   * The notification publisher that propagates invalidation across the cache
   * cluster.
   *
   * **Important**: a trigger publishes invalidations on behalf of an external
   * domain event, not on behalf of any local Loader. Pass a publisher that has
   * its own server UUID (distinct from any Loader's notification pair),
   * otherwise the local pair's consumer will treat the trigger's messages as
   * self-emitted and drop them — leaving the local in-memory cache stale.
   *
   * Construct one with:
   * ```
   * const triggerPublisher = new SqsNotificationPublisher({
   *   serverUuid: randomUUID(),
   *   dependencies, locatorConfig: { topicName: 'app-invalidations' },
   * })
   * ```
   */
  publisher: NotificationPublisher<unknown>
  errorHandler?: TriggerErrorHandler
  /** Logical channel name passed to {@link errorHandler}. Defaults to a derived value. */
  channel?: string
} & SqsTriggerSourceConfig

type FlatTriggerContext<TMessage> = {
  resolver: InvalidationResolver<TMessage, InvalidationAction>
  publisher: NotificationPublisher<unknown>
  channel: string
  errorHandler: TriggerErrorHandler | undefined
}

export class SqsInvalidationTrigger<TMessage extends object> extends AbstractSqsTrigger<
  TMessage,
  FlatTriggerContext<TMessage>
> {
  protected readonly source: SqsTriggerSource
  protected readonly messageType = TRIGGER_MESSAGE_TYPE
  protected readonly channel: string

  private readonly messageSchema: ZodSchema<TMessage>
  private readonly resolver: InvalidationResolver<TMessage, InvalidationAction>
  private readonly publisher: NotificationPublisher<unknown>
  private readonly errorHandler: TriggerErrorHandler | undefined

  constructor(params: SqsInvalidationTriggerParams<TMessage>) {
    super()
    const { messageSchema, resolver, publisher, errorHandler, channel, ...source } = params
    this.source = source as SqsTriggerSource
    this.messageSchema = messageSchema
    this.resolver = resolver
    this.publisher = publisher
    this.errorHandler = errorHandler
    this.channel = channel ?? deriveTriggerChannelName(this.source)
  }

  protected buildContext(): FlatTriggerContext<TMessage> {
    return {
      resolver: this.resolver,
      publisher: this.publisher,
      channel: this.channel,
      errorHandler: this.errorHandler,
    }
  }

  protected buildHandlers(): MessageHandlerConfig<
    TMessage,
    FlatTriggerContext<TMessage>,
    undefined
  >[] {
    return new MessageHandlerConfigBuilder<TMessage, FlatTriggerContext<TMessage>>()
      .addConfig(
        this.messageSchema,
        async (message, ctx) => {
          try {
            await runFlatPipeline(message, ctx.resolver, ctx.publisher)
            return { result: 'success' as const }
          } catch (err) {
            ctx.errorHandler?.(err as Error, ctx.channel)
            // Re-throw so message-queue-toolkit's standard retry/DLQ flow takes over.
            throw err
          }
        },
        { messageType: TRIGGER_MESSAGE_TYPE },
      )
      .build()
  }
}
