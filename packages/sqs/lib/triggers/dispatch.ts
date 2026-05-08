import type { GroupNotificationPublisher, NotificationPublisher } from 'layered-loader'
import type {
  GroupInvalidationAction,
  InvalidationAction,
  InvalidationResolver,
  ResolverOutput,
} from './types.js'

function toArray<T>(output: ResolverOutput<T>): readonly T[] {
  if (output == null) return []
  // T is a discriminated-union object type, never an array, so narrowing via
  // Array.isArray is safe — but TS can't prove that for an arbitrary T.
  return Array.isArray(output) ? output : ([output] as readonly T[])
}

function assertNever(value: never, label: string): never {
  throw new Error(`Unhandled ${label} kind: ${JSON.stringify(value)}`)
}

/**
 * Apply a resolved {@link InvalidationAction} to a flat
 * {@link NotificationPublisher}.
 */
export async function applyFlatAction(
  action: InvalidationAction,
  publisher: NotificationPublisher<unknown>,
): Promise<void> {
  switch (action.kind) {
    case 'delete':
      await publisher.delete(action.key)
      return
    case 'deleteMany':
      await publisher.deleteMany([...action.keys])
      return
    case 'set':
      await publisher.set(action.key, action.value)
      return
    case 'clear':
      await publisher.clear()
      return
    default:
      assertNever(action, 'InvalidationAction')
  }
}

/**
 * Apply a resolved {@link GroupInvalidationAction} to a
 * {@link GroupNotificationPublisher}.
 */
export async function applyGroupAction(
  action: GroupInvalidationAction,
  publisher: GroupNotificationPublisher<unknown>,
): Promise<void> {
  switch (action.kind) {
    case 'deleteFromGroup':
      await publisher.deleteFromGroup(action.key, action.group)
      return
    case 'deleteGroup':
      await publisher.deleteGroup(action.group)
      return
    case 'clear':
      await publisher.clear()
      return
    default:
      assertNever(action, 'GroupInvalidationAction')
  }
}

/**
 * Run the resolver and apply each emitted action sequentially. Errors
 * propagate to the caller, allowing the transport adapter to decide whether
 * to retry the source message.
 */
export async function runFlatPipeline<TMessage>(
  message: TMessage,
  resolver: InvalidationResolver<TMessage, InvalidationAction>,
  publisher: NotificationPublisher<unknown>,
): Promise<void> {
  const result = await resolver(message)
  for (const action of toArray(result)) {
    await applyFlatAction(action, publisher)
  }
}

export async function runGroupPipeline<TMessage>(
  message: TMessage,
  resolver: InvalidationResolver<TMessage, GroupInvalidationAction>,
  publisher: GroupNotificationPublisher<unknown>,
): Promise<void> {
  const result = await resolver(message)
  for (const action of toArray(result)) {
    await applyGroupAction(action, publisher)
  }
}
