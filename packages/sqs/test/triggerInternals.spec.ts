import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  AbstractSqsTrigger,
  type InternalConsumerHandle,
} from '../lib/triggers/AbstractSqsTrigger.js'
import { buildFlatBindings } from '../lib/triggers/bindingHelpers.js'
import { buildSnsTriggerConsumerOptions } from '../lib/triggers/SnsTopicInvalidationTrigger.js'

const EVENT_SCHEMA = z.object({ id: z.string() })

function buildBindings() {
  return buildFlatBindings(
    [{ messageSchema: EVENT_SCHEMA, resolver: () => null }],
    undefined,
    { invalidate: async () => {}, invalidateMany: async () => {} } as never,
    'test-channel',
    undefined,
  )
}

describe('buildSnsTriggerConsumerOptions', () => {
  it('injects the binding-derived handlers and message-type resolver', () => {
    const built = buildBindings()
    const options = buildSnsTriggerConsumerOptions(
      { creationConfig: { topic: { Name: 't' }, queue: { QueueName: 'q' } } },
      built,
    )

    expect(options.handlers).toBe(built.handlers)
    expect(options.messageTypeResolver).toBe(built.messageTypeResolver)
  })

  it('drops the handler-derived subscription filter policy (Attributes)', () => {
    const built = buildBindings()
    const options = buildSnsTriggerConsumerOptions(
      {
        creationConfig: { topic: { Name: 't' }, queue: { QueueName: 'q' } },
        subscriptionConfig: {
          updateAttributesIfExists: true,
          // A reject-all policy resolveConsumerOptions() derived from empty handlers.
          Attributes: {
            FilterPolicy: JSON.stringify({ type: ['__never__'] }),
            FilterPolicyScope: 'MessageBody',
          },
        },
      },
      built,
    )

    expect(options.subscriptionConfig?.Attributes).toBeUndefined()
    // ...but the caller's other subscription settings are preserved.
    expect(options.subscriptionConfig?.updateAttributesIfExists).toBe(true)
  })

  it('preserves a subscription-level RedrivePolicy while dropping the filter policy', () => {
    const redrivePolicy = JSON.stringify({ deadLetterTargetArn: 'arn:aws:sqs:::sub-dlq' })
    const options = buildSnsTriggerConsumerOptions(
      {
        creationConfig: { topic: { Name: 't' }, queue: { QueueName: 'q' } },
        subscriptionConfig: {
          updateAttributesIfExists: true,
          Attributes: {
            FilterPolicy: JSON.stringify({ type: ['__never__'] }),
            RedrivePolicy: redrivePolicy,
            RawMessageDelivery: 'true',
          },
        },
      },
      buildBindings(),
    )

    // The subscription DLQ (and other non-filter attributes) survive...
    expect(options.subscriptionConfig?.Attributes).toEqual({
      RedrivePolicy: redrivePolicy,
      RawMessageDelivery: 'true',
    })
    // ...while the handler-derived filter policy is gone.
    expect(options.subscriptionConfig?.Attributes?.FilterPolicy).toBeUndefined()
  })

  it('defaults updateAttributesIfExists to false when no subscriptionConfig is given', () => {
    const options = buildSnsTriggerConsumerOptions(
      { creationConfig: { topic: { Name: 't' }, queue: { QueueName: 'q' } } },
      buildBindings(),
    )

    expect(options.subscriptionConfig?.updateAttributesIfExists).toBe(false)
  })

  it('forwards a spread-in subscriptionDeadLetterQueue untouched', () => {
    const options = buildSnsTriggerConsumerOptions(
      {
        creationConfig: { topic: { Name: 't' }, queue: { QueueName: 'q' } },
        deadLetterQueue: {
          redrivePolicy: { maxReceiveCount: 3 },
          creationConfig: { queue: { QueueName: 'q-dlq' } },
        },
        // Not part of the vendored typed surface, but rides along on a
        // resolveConsumerOptions() spread / newer toolkit versions.
        subscriptionDeadLetterQueue: { reuseConsumerDeadLetterQueue: true },
      } as Parameters<typeof buildSnsTriggerConsumerOptions>[0],
      buildBindings(),
    )

    // The subscription-level DLQ directive flows through to the consumer.
    expect((options as { subscriptionDeadLetterQueue?: unknown }).subscriptionDeadLetterQueue).toEqual(
      { reuseConsumerDeadLetterQueue: true },
    )
    // The queue-level DLQ is forwarded untouched as well.
    expect(options.deadLetterQueue).toEqual({
      redrivePolicy: { maxReceiveCount: 3 },
      creationConfig: { queue: { QueueName: 'q-dlq' } },
    })
  })

  it('forwards unrelated consumer options untouched', () => {
    const options = buildSnsTriggerConsumerOptions(
      {
        creationConfig: { topic: { Name: 't' }, queue: { QueueName: 'q' } },
        concurrentConsumersAmount: 4,
      },
      buildBindings(),
    )

    expect(options.creationConfig).toEqual({ topic: { Name: 't' }, queue: { QueueName: 'q' } })
    expect(options.concurrentConsumersAmount).toBe(4)
  })
})

describe('AbstractSqsTrigger lifecycle', () => {
  class CountingHandle implements InternalConsumerHandle {
    initCalls = 0
    startCalls = 0
    closeCalls = 0
    async init() {
      this.initCalls++
    }
    async start() {
      this.startCalls++
    }
    async close() {
      this.closeCalls++
    }
  }

  class TestTrigger extends AbstractSqsTrigger {
    constructor(private readonly handles: readonly InternalConsumerHandle[]) {
      super()
    }
    protected createConsumers(): readonly InternalConsumerHandle[] {
      return this.handles
    }
  }

  it('starts each consumer exactly once and never calls init() separately', async () => {
    // The underlying consumer's start() runs init() internally; the trigger must
    // not also call init(), or every queue re-subscribes and conflicts with the
    // attributes (filter/redrive policy) set on the first subscribe.
    const handles = [new CountingHandle(), new CountingHandle()]
    const trigger = new TestTrigger(handles)

    await trigger.start()

    for (const handle of handles) {
      expect(handle.startCalls).toBe(1)
      expect(handle.initCalls).toBe(0)
    }
  })

  it('closes every consumer on stop()', async () => {
    const handles = [new CountingHandle(), new CountingHandle()]
    const trigger = new TestTrigger(handles)

    await trigger.start()
    await trigger.stop()

    for (const handle of handles) {
      expect(handle.closeCalls).toBe(1)
    }
  })
})
