/**
 * Transport-agnostic primitives for building invalidation triggers.
 *
 * A trigger consumes domain events from an arbitrary upstream messaging system
 * (SNS topic, SQS queue, RabbitMQ exchange, Kafka topic, ...) that has no
 * knowledge of the caching layer. An {@link InvalidationResolver} maps each
 * incoming message to one or more invalidation actions, which the trigger then
 * applies to a configured {@link InvalidationTarget} — typically a `Loader`
 * or `GroupLoader`. The target's own notification publisher (if any) takes
 * care of fanning the invalidation out to peer instances.
 */

/** Invalidation operations a flat-cache trigger may emit. */
export type InvalidationAction =
  | { kind: 'delete'; key: string }
  | { kind: 'deleteMany'; keys: readonly string[] }
  | { kind: 'clear' }

/** Invalidation operations a group-cache trigger may emit. */
export type GroupInvalidationAction =
  | { kind: 'deleteFromGroup'; key: string; group: string }
  | { kind: 'deleteGroup'; group: string }
  | { kind: 'clear' }

export type ResolverOutput<TAction> = TAction | readonly TAction[] | null | undefined

/**
 * Pure function turning a parsed upstream message into invalidation
 * action(s). Return `undefined`/`null` to skip the message.
 */
export type InvalidationResolver<TMessage, TAction> = (
  message: TMessage,
) => ResolverOutput<TAction> | Promise<ResolverOutput<TAction>>

/**
 * Minimal surface a flat trigger needs from a `Loader` (or any other cache
 * facade) to apply resolved {@link InvalidationAction}s locally. `Loader`
 * satisfies this structurally.
 */
export interface InvalidationTarget {
  invalidateCacheFor(key: string): Promise<void>
  invalidateCacheForMany(keys: string[]): Promise<void>
  invalidateCache(): Promise<void>
}

/**
 * Minimal surface a group trigger needs from a `GroupLoader`. `GroupLoader`
 * satisfies this structurally.
 */
export interface GroupInvalidationTarget {
  invalidateCacheFor(key: string, group: string): Promise<void>
  invalidateCacheForGroup(group: string): Promise<void>
  invalidateCache(): Promise<void>
}

/** Lifecycle contract every trigger implementation honours. */
export interface InvalidationTrigger {
  /** Begin consuming messages from the upstream source(s). Idempotent. */
  start(): Promise<void>
  /** Stop consuming and release resources. Idempotent. */
  stop(): Promise<void>
}

/**
 * Invoked when the trigger pipeline (resolver + apply) fails for a single
 * message. The transport may re-deliver the message regardless; this hook is
 * for observability only.
 */
export type TriggerErrorHandler = (err: Error, channel: string) => void
