import { type MessageHandlerConfig, MessageHandlerConfigBuilder } from '@message-queue-toolkit/core'
import type { ZodSchema } from 'zod'
import { runFlatPipeline, runGroupPipeline } from './dispatch.js'
import type {
  GroupInvalidationAction,
  GroupInvalidationTarget,
  InvalidationAction,
  InvalidationResolver,
  InvalidationTarget,
  TriggerErrorHandler,
} from './types.js'

const DEFAULT_FLAT_MESSAGE_TYPE = 'layered-loader.invalidation-trigger'
const DEFAULT_GROUP_MESSAGE_TYPE = 'layered-loader.group-invalidation-trigger'

export type MessageTypeResolver =
  | { literal: string }
  | { messageTypePath: string }

export type FlatBinding<TMessage extends object> = {
  messageSchema: ZodSchema<TMessage>
  resolver: InvalidationResolver<TMessage, InvalidationAction>
  messageType?: string
}

export type GroupBinding<TMessage extends object> = {
  messageSchema: ZodSchema<TMessage>
  resolver: InvalidationResolver<TMessage, GroupInvalidationAction>
  messageType?: string
}

export type BindingHandlerContext<TTarget> = {
  target: TTarget
  channel: string
  errorHandler: TriggerErrorHandler | undefined
}

export type BuiltBindings<TTarget> = {
  handlers: MessageHandlerConfig<object, BindingHandlerContext<TTarget>, undefined>[]
  context: BindingHandlerContext<TTarget>
  messageTypeResolver: MessageTypeResolver
}

/** Validates the binding shape rules common to every trigger source. */
function validateBindings(
  // biome-ignore lint/suspicious/noExplicitAny: bindings are heterogeneous over TMessage
  bindings: readonly { messageType?: string; messageSchema: ZodSchema<any> }[],
  messageTypeField: string | undefined,
  channel: string,
): void {
  if (bindings.length === 0) {
    throw new Error(`Source "${channel}" must declare at least one binding`)
  }
  if (bindings.length > 1) {
    if (!messageTypeField) {
      throw new Error(
        `Source "${channel}" has ${bindings.length} bindings but no messageTypeField; specify the message body path that discriminates them`,
      )
    }
    for (const binding of bindings) {
      if (!binding.messageType) {
        throw new Error(
          `Source "${channel}" has multiple bindings but at least one omits 'messageType'`,
        )
      }
    }
  }
}

/** Build handler config + context for a flat-trigger source's bindings. */
export function buildFlatBindings(
  // biome-ignore lint/suspicious/noExplicitAny: bindings are heterogeneous
  bindings: readonly FlatBinding<any>[],
  messageTypeField: string | undefined,
  target: InvalidationTarget,
  channel: string,
  errorHandler: TriggerErrorHandler | undefined,
): BuiltBindings<InvalidationTarget> {
  validateBindings(bindings, messageTypeField, channel)

  const messageTypeResolver: MessageTypeResolver = messageTypeField
    ? { messageTypePath: messageTypeField }
    : { literal: bindings[0]!.messageType ?? DEFAULT_FLAT_MESSAGE_TYPE }
  const context: BindingHandlerContext<InvalidationTarget> = { target, channel, errorHandler }

  const builder = new MessageHandlerConfigBuilder<object, BindingHandlerContext<InvalidationTarget>>()
  for (const binding of bindings) {
    const messageType =
      binding.messageType ?? (messageTypeResolver as { literal: string }).literal
    builder.addConfig(
      binding.messageSchema as ZodSchema<object>,
      async (message, ctx) => {
        try {
          await runFlatPipeline(
            message,
            binding.resolver as InvalidationResolver<object, InvalidationAction>,
            ctx.target,
          )
          return { result: 'success' as const }
        } catch (err) {
          ctx.errorHandler?.(err as Error, ctx.channel)
          throw err
        }
      },
      { messageType },
    )
  }

  return { handlers: builder.build(), context, messageTypeResolver }
}

/** Build handler config + context for a group-trigger source's bindings. */
export function buildGroupBindings(
  // biome-ignore lint/suspicious/noExplicitAny: bindings are heterogeneous
  bindings: readonly GroupBinding<any>[],
  messageTypeField: string | undefined,
  target: GroupInvalidationTarget,
  channel: string,
  errorHandler: TriggerErrorHandler | undefined,
): BuiltBindings<GroupInvalidationTarget> {
  validateBindings(bindings, messageTypeField, channel)

  const messageTypeResolver: MessageTypeResolver = messageTypeField
    ? { messageTypePath: messageTypeField }
    : { literal: bindings[0]!.messageType ?? DEFAULT_GROUP_MESSAGE_TYPE }
  const context: BindingHandlerContext<GroupInvalidationTarget> = {
    target,
    channel,
    errorHandler,
  }

  const builder = new MessageHandlerConfigBuilder<
    object,
    BindingHandlerContext<GroupInvalidationTarget>
  >()
  for (const binding of bindings) {
    const messageType =
      binding.messageType ?? (messageTypeResolver as { literal: string }).literal
    builder.addConfig(
      binding.messageSchema as ZodSchema<object>,
      async (message, ctx) => {
        try {
          await runGroupPipeline(
            message,
            binding.resolver as InvalidationResolver<object, GroupInvalidationAction>,
            ctx.target,
          )
          return { result: 'success' as const }
        } catch (err) {
          ctx.errorHandler?.(err as Error, ctx.channel)
          throw err
        }
      },
      { messageType },
    )
  }

  return { handlers: builder.build(), context, messageTypeResolver }
}
