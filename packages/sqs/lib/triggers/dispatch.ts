import type {
  GroupInvalidationAction,
  GroupInvalidationTarget,
  InvalidationAction,
  InvalidationResolver,
  InvalidationTarget,
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
 * Apply a resolved {@link InvalidationAction} to an {@link InvalidationTarget}.
 *
 * The target (typically a `Loader`) takes care of removing entries from both
 * its in-memory and async caches and — if it was configured with a
 * notification publisher — propagates the invalidation to peer instances.
 */
export async function applyFlatAction(
  action: InvalidationAction,
  target: InvalidationTarget,
): Promise<void> {
  switch (action.kind) {
    case 'delete':
      await target.invalidateCacheFor(action.key)
      return
    case 'deleteMany':
      await target.invalidateCacheForMany([...action.keys])
      return
    case 'clear':
      await target.invalidateCache()
      return
    default:
      assertNever(action, 'InvalidationAction')
  }
}

/**
 * Apply a resolved {@link GroupInvalidationAction} to a
 * {@link GroupInvalidationTarget}.
 */
export async function applyGroupAction(
  action: GroupInvalidationAction,
  target: GroupInvalidationTarget,
): Promise<void> {
  switch (action.kind) {
    case 'deleteFromGroup':
      await target.invalidateCacheFor(action.key, action.group)
      return
    case 'deleteGroup':
      await target.invalidateCacheForGroup(action.group)
      return
    case 'clear':
      await target.invalidateCache()
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
  target: InvalidationTarget,
): Promise<void> {
  const result = await resolver(message)
  for (const action of toArray(result)) {
    await applyFlatAction(action, target)
  }
}

export async function runGroupPipeline<TMessage>(
  message: TMessage,
  resolver: InvalidationResolver<TMessage, GroupInvalidationAction>,
  target: GroupInvalidationTarget,
): Promise<void> {
  const result = await resolver(message)
  for (const action of toArray(result)) {
    await applyGroupAction(action, target)
  }
}
