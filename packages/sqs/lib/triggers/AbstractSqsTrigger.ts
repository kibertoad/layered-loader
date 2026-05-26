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
      const consumers = this.createConsumers()
      if (consumers.length === 0) return
      try {
        await Promise.all(consumers.map((c) => c.init()))
        await Promise.all(consumers.map((c) => c.start()))
        this.internalConsumers = [...consumers]
      } catch (err) {
        await Promise.allSettled(consumers.map((c) => c.close().catch(() => undefined)))
        throw err
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
      await Promise.all(triggers.map((t) => t.start()))
    },
    async stop() {
      await Promise.allSettled(triggers.map((t) => t.stop()))
    },
  }
}
