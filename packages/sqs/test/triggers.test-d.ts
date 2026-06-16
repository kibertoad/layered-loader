import type { SNSSQSConsumerOptions } from '@message-queue-toolkit/sns'
import type { SQSConsumerOptions } from '@message-queue-toolkit/sqs'
import { assertType, describe, expectTypeOf, test } from 'vitest'
import { z } from 'zod'
import type {
  SnsTopicGroupInvalidationDeadLetterQueueConfig,
  SnsTopicGroupInvalidationSource,
  SnsTopicInvalidationDeadLetterQueueConfig,
  SnsTopicInvalidationSource,
  SqsQueueGroupInvalidationDeadLetterQueueConfig,
  SqsQueueGroupInvalidationSource,
  SqsQueueInvalidationDeadLetterQueueConfig,
  SqsQueueInvalidationSource,
} from '../index.js'

// Pre-resolved consumer options, as produced by e.g.
// `@lokalise/aws-config`'s `resolveConsumerOptions(...)`.
declare const snsOptions: SNSSQSConsumerOptions<object, unknown, undefined>
declare const sqsOptions: SQSConsumerOptions<object, unknown, undefined>

const SCHEMA = z.object({ type: z.string() })
const flatBinding = { messageSchema: SCHEMA, resolver: () => null } as const
const groupBinding = { messageSchema: SCHEMA, resolver: () => null } as const

describe('trigger source types: spread + explicit configuration', () => {
  test('SnsTopicInvalidationSource', () => {
    // Spread a pre-resolved options object.
    assertType<SnsTopicInvalidationSource>({ ...snsOptions, bindings: [flatBinding] })

    // Explicit, minimal.
    assertType<SnsTopicInvalidationSource>({
      creationConfig: { topic: { Name: 't' }, queue: { QueueName: 'q' } },
      bindings: [flatBinding],
    })

    // Explicit, with extra consumer options + DLQ + subscriptionConfig.
    assertType<SnsTopicInvalidationSource>({
      creationConfig: { topic: { Name: 't' }, queue: { QueueName: 'q' } },
      concurrentConsumersAmount: 4,
      subscriptionConfig: { updateAttributesIfExists: true },
      deadLetterQueue: {
        redrivePolicy: { maxReceiveCount: 3 },
        creationConfig: { queue: { QueueName: 'q-dlq' } },
      },
      bindings: [flatBinding],
    })

    // The trigger owns `handlers`, so callers must not be forced to provide it.
    expectTypeOf<SnsTopicInvalidationSource>().not.toHaveProperty('handlers')

    assertType<SnsTopicInvalidationSource>({
      // @ts-expect-error unknown property must be rejected (typo detection)
      totallyBogusField: true,
      creationConfig: { topic: { Name: 't' }, queue: { QueueName: 'q' } },
      bindings: [flatBinding],
    })

    assertType<SnsTopicInvalidationSource>({
      // @ts-expect-error wrong creationConfig shape must be rejected
      creationConfig: { nonsense: 1 },
      bindings: [flatBinding],
    })
  })

  test('SnsTopicGroupInvalidationSource', () => {
    assertType<SnsTopicGroupInvalidationSource>({ ...snsOptions, bindings: [groupBinding] })

    assertType<SnsTopicGroupInvalidationSource>({
      locatorConfig: { topicArn: 'arn:aws:sns:...', queueUrl: 'https://...' },
      deadLetterQueue: { redrivePolicy: { maxReceiveCount: 5 } },
      bindings: [groupBinding],
    })

    expectTypeOf<SnsTopicGroupInvalidationSource>().not.toHaveProperty('handlers')

    assertType<SnsTopicGroupInvalidationSource>({
      // @ts-expect-error unknown property must be rejected
      nope: true,
      creationConfig: { topic: { Name: 't' }, queue: { QueueName: 'q' } },
      bindings: [groupBinding],
    })
  })

  test('SqsQueueInvalidationSource', () => {
    assertType<SqsQueueInvalidationSource>({ ...sqsOptions, bindings: [flatBinding] })

    assertType<SqsQueueInvalidationSource>({
      locatorConfig: { queueUrl: 'https://...' },
      concurrentConsumersAmount: 2,
      deadLetterQueue: {
        redrivePolicy: { maxReceiveCount: 3 },
        creationConfig: { queue: { QueueName: 'q-dlq' } },
      },
      bindings: [flatBinding],
    })

    expectTypeOf<SqsQueueInvalidationSource>().not.toHaveProperty('handlers')

    assertType<SqsQueueInvalidationSource>({
      // @ts-expect-error unknown property must be rejected
      totallyBogusField: true,
      locatorConfig: { queueUrl: 'https://...' },
      bindings: [flatBinding],
    })
  })

  test('SqsQueueGroupInvalidationSource', () => {
    assertType<SqsQueueGroupInvalidationSource>({ ...sqsOptions, bindings: [groupBinding] })

    assertType<SqsQueueGroupInvalidationSource>({
      creationConfig: { queue: { QueueName: 'q' } },
      bindings: [groupBinding],
    })

    expectTypeOf<SqsQueueGroupInvalidationSource>().not.toHaveProperty('handlers')

    assertType<SqsQueueGroupInvalidationSource>({
      // @ts-expect-error unknown property must be rejected
      nope: true,
      creationConfig: { queue: { QueueName: 'q' } },
      bindings: [groupBinding],
    })
  })
})

describe('dead-letter-queue helper types', () => {
  test('each exposes redrivePolicy + create/locate', () => {
    const dlqConfigs = [
      {} as SnsTopicInvalidationDeadLetterQueueConfig,
      {} as SnsTopicGroupInvalidationDeadLetterQueueConfig,
      {} as SqsQueueInvalidationDeadLetterQueueConfig,
      {} as SqsQueueGroupInvalidationDeadLetterQueueConfig,
    ]

    expectTypeOf(dlqConfigs[0]!.redrivePolicy).toEqualTypeOf<{ maxReceiveCount: number }>()
    expectTypeOf(dlqConfigs[0]!).toHaveProperty('creationConfig')
    expectTypeOf(dlqConfigs[0]!).toHaveProperty('locatorConfig')

    // A standalone DLQ object can be built against the exported helper type.
    assertType<SnsTopicInvalidationDeadLetterQueueConfig>({
      redrivePolicy: { maxReceiveCount: 5 },
      creationConfig: { queue: { QueueName: 'q-dlq' } },
    })
  })
})
