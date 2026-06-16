import {
  AbstractSnsSqsConsumer,
  type SNSSQSConsumerDependencies,
  type SNSSQSConsumerOptions,
} from '@message-queue-toolkit/sns'
import {
  AbstractSqsConsumer,
  type SQSConsumerDependencies,
  type SQSConsumerOptions,
} from '@message-queue-toolkit/sqs'
import type { InvalidationTrigger } from './types.js'

/** Minimal lifecycle slice we need from the underlying message-queue-toolkit consumer. */
export interface InternalConsumerHandle {
  init(): Promise<void>
  start(): Promise<void>
  close(abort?: boolean): Promise<void>
}

/**
 * Concrete subclass of `AbstractSqsConsumer` — the upstream class is abstract,
 * but we just need its constructor.
 */
export class SqsQueueTriggerConsumer<TMessage extends object, TContext> extends AbstractSqsConsumer<
  TMessage,
  TContext
> {
  constructor(
    dependencies: SQSConsumerDependencies,
    options: SQSConsumerOptions<TMessage, TContext, undefined>,
    context: TContext,
  ) {
    super(dependencies, options, context)
  }
}

/**
 * Concrete subclass of `AbstractSnsSqsConsumer` — the upstream class is
 * abstract, but we just need its constructor.
 */
export class SnsTopicTriggerConsumer<
  TMessage extends object,
  TContext,
> extends AbstractSnsSqsConsumer<TMessage, TContext> {
  constructor(
    dependencies: SNSSQSConsumerDependencies,
    options: SNSSQSConsumerOptions<TMessage, TContext, undefined>,
    context: TContext,
  ) {
    super(dependencies, options, context)
  }
}

/**
 * Shared lifecycle for SQS-based triggers: starts and stops a set of
 * underlying message-queue-toolkit consumers as a single unit. Subclasses
 * decide how those consumers are built (which AWS deps, which source config,
 * which handlers); the abstract only manages their lifetime.
 */
export abstract class AbstractSqsTrigger implements InvalidationTrigger {
  private internalConsumers: InternalConsumerHandle[] = []
  private startPromise?: Promise<void>

  /**
   * Build one underlying consumer per upstream source the trigger should
   * subscribe to. Called once per `start()`; subclasses are free to do
   * arbitrary work (validation, channel-name derivation, etc.).
   */
  protected abstract createConsumers(): readonly InternalConsumerHandle[]

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    if (this.internalConsumers.length > 0) return
    this.startPromise = (async () => {
      try {
        // createConsumers() can throw (e.g. binding validation in subclasses);
        // keep it inside the outer try so a failure still clears startPromise
        // via the finally below instead of leaving the trigger wedged on a
        // rejected promise forever.
        const consumers = this.createConsumers()
        if (consumers.length === 0) return
        try {
          // Only call start(): the underlying message-queue-toolkit consumer's
          // start() already runs init() internally. Calling init() here as well
          // would init() every consumer twice, and the second pass re-subscribes
          // the queue to its topic — which conflicts with subscription attributes
          // (filter policy, redrive policy) applied on the first pass. start()
          // also provisions all resources, so nothing is lost by dropping the
          // separate init() barrier.
          await Promise.all(consumers.map((c) => c.start()))
          this.internalConsumers = [...consumers]
        } catch (err) {
          await Promise.allSettled(consumers.map((c) => c.close().catch(() => undefined)))
          throw err
        }
      } finally {
        this.startPromise = undefined
      }
    })()
    return this.startPromise
  }

  async stop(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise.catch(() => undefined)
    }
    const consumers = this.internalConsumers
    if (consumers.length === 0) return
    this.internalConsumers = []
    // Use allSettled so a single consumer's failure doesn't skip cleanup of the rest.
    // Rejections are intentionally swallowed: shutdown is best-effort, the caller has
    // no useful recovery action, and the underlying connection may already be closed.
    await Promise.allSettled(consumers.map((c) => c.close()))
  }
}

/**
 * Combines several {@link InvalidationTrigger}s into one. Useful when a single
 * deployment needs to react to events from heterogeneous source types (e.g.
 * one SNS-topic trigger plus one SQS-queue trigger) and wants to manage them
 * as a single start/stop unit.
 */
export function composeTriggers(
  ...triggers: readonly InvalidationTrigger[]
): InvalidationTrigger {
  return {
    async start() {
      const results = await Promise.allSettled(triggers.map((t) => t.start()))
      const reasons = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => r.reason)
      if (reasons.length === 0) return
      // Roll back any triggers that did start so a partial failure
      // doesn't leak still-running consumers.
      const started = triggers.filter((_, i) => results[i].status === 'fulfilled')
      await Promise.allSettled(started.map((t) => t.stop()))
      if (reasons.length === 1) throw reasons[0]
      throw new AggregateError(reasons, 'One or more triggers failed to start')
    },
    async stop() {
      // allSettled so one trigger's failure doesn't skip cleanup of the rest.
      // Rejections are logged but not rethrown: shutdown is best-effort and
      // the caller can't usefully recover, but a silent failure during stop
      // would be hard to diagnose, so we surface it via the logger.
      const results = await Promise.allSettled(triggers.map((t) => t.stop()))
      for (const result of results) {
        if (result.status === 'rejected') {
          console.error('composeTriggers: trigger stop failed', result.reason)
        }
      }
    },
  }
}
