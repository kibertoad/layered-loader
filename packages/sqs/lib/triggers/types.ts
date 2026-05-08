/**
 * Transport-agnostic primitives for building invalidation triggers.
 *
 * A trigger consumes domain events from an arbitrary upstream messaging system
 * (SNS topic, SQS queue, RabbitMQ exchange, Kafka topic, ...) that has no
 * knowledge of the caching layer. A {@link InvalidationResolver} maps each
 * incoming message to one or more {@link InvalidationAction}s, which the
 * trigger then dispatches via a configured layered-loader notification
 * publisher to fan out across the cache cluster.
 */

/** Invalidation operations supported by `NotificationPublisher`. */
export type InvalidationAction =
  | { kind: 'delete'; key: string }
  | { kind: 'deleteMany'; keys: readonly string[] }
  | { kind: 'set'; key: string; value: unknown }
  | { kind: 'clear' }

/** Invalidation operations supported by `GroupNotificationPublisher`. */
export type GroupInvalidationAction =
  | { kind: 'deleteFromGroup'; key: string; group: string }
  | { kind: 'deleteGroup'; group: string }
  | { kind: 'clear' }

export type ResolverOutput<TAction> =
  | TAction
  | readonly TAction[]
  | null
  | undefined
  | void

/**
 * Pure function turning a parsed upstream message into invalidation
 * action(s). Return `undefined`/`null` to skip the message.
 */
export type InvalidationResolver<TMessage, TAction> = (
  message: TMessage,
) => ResolverOutput<TAction> | Promise<ResolverOutput<TAction>>

/** Lifecycle contract every trigger implementation honours. */
export interface InvalidationTrigger {
  /** Begin consuming messages from the upstream source. */
  start(): Promise<void>
  /** Stop consuming and release resources. Idempotent. */
  stop(): Promise<void>
}

/**
 * Invoked when the trigger pipeline (resolver + publish) fails for a single
 * message. The transport may re-deliver the message regardless; this hook is
 * for observability only.
 */
export type TriggerErrorHandler = (err: Error, channel: string) => void
