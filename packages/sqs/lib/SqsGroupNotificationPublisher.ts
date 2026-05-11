import { randomUUID } from 'node:crypto'
import {
  AbstractSnsPublisher,
  type SNSCreationConfig,
  type SNSDependencies,
  type SNSPublisherOptions,
  type SNSTopicLocatorType,
} from '@message-queue-toolkit/sns'
import type { GroupNotificationPublisher, PublisherErrorHandler } from 'layered-loader'
import { resolveChannelName } from './channelNameResolver.js'
import {
  CLEAR_COMMAND,
  DELETE_FROM_GROUP_COMMAND,
  DELETE_GROUP_COMMAND,
  GROUP_NOTIFICATION_SCHEMAS,
  type GroupNotificationCommand,
  NOTIFICATION_ID_FIELD,
  NOTIFICATION_TIMESTAMP_FIELD,
  NOTIFICATION_TYPE_FIELD,
} from './groupNotificationSchemas.js'

const DEFAULT_PUBLISHER_ERROR_HANDLER: PublisherErrorHandler = (err, channel, logger) => {
  logger.error(`Error while publishing notification to channel ${channel}: ${err.message}`)
}

class SnsGroupInvalidationPublisher extends AbstractSnsPublisher<
  GroupNotificationCommand
> {
  get publicTopicArn(): string {
    return this.topicArn
  }
}

export type SqsGroupNotificationPublisherConfig =
  | { creationConfig: SNSCreationConfig; locatorConfig?: never }
  | { creationConfig?: never; locatorConfig: SNSTopicLocatorType }

export type SqsGroupNotificationPublisherParams = {
  serverUuid: string
  errorHandler?: PublisherErrorHandler
  channel?: string
  dependencies: SNSDependencies
} & SqsGroupNotificationPublisherConfig

export class SqsGroupNotificationPublisher<LoadedValue>
  implements GroupNotificationPublisher<LoadedValue>
{
  public readonly channel: string
  public readonly errorHandler: PublisherErrorHandler

  private readonly serverUuid: string
  private readonly publisher: SnsGroupInvalidationPublisher
  private initPromise?: Promise<void>
  private initialized = false

  constructor(params: SqsGroupNotificationPublisherParams) {
    this.serverUuid = params.serverUuid
    this.errorHandler = params.errorHandler ?? DEFAULT_PUBLISHER_ERROR_HANDLER
    this.channel = resolveChannelName(params)

    // mqt's `messageSchemas` is `readonly ZodSchema<UnionType>[]`. Our schemas
    // are narrower (one per command type) and `ZodSchema` is invariant in T,
    // so the array of narrow schemas does not satisfy the broad type at the
    // type level — even though mqt resolves them correctly at runtime via the
    // configured `messageTypeResolver`.
    const options = {
      messageSchemas: GROUP_NOTIFICATION_SCHEMAS,
      messageTypeResolver: { messageTypePath: NOTIFICATION_TYPE_FIELD },
      messageIdField: NOTIFICATION_ID_FIELD,
      messageTimestampField: NOTIFICATION_TIMESTAMP_FIELD,
      ...(params.creationConfig
        ? { creationConfig: params.creationConfig }
        : { locatorConfig: params.locatorConfig }),
    } as unknown as SNSPublisherOptions<GroupNotificationCommand>

    this.publisher = new SnsGroupInvalidationPublisher(params.dependencies, options)
  }

  async subscribe(): Promise<void> {
    if (this.initialized) return

    if (!this.initPromise) {
      this.initPromise = this.initializePublisher()
    }
    return this.initPromise
  }

  private async initializePublisher(): Promise<void> {
    try {
      await this.publisher.init()
      this.initialized = true
    } catch (err) {
      this.initPromise = undefined
      throw err
    }
  }

  deleteFromGroup(key: string, group: string): Promise<unknown> {
    return this.publishCommand({
      type: DELETE_FROM_GROUP_COMMAND,
      key,
      group,
      ...this.buildEnvelope(),
    })
  }

  deleteGroup(group: string): Promise<unknown> {
    return this.publishCommand({
      type: DELETE_GROUP_COMMAND,
      group,
      ...this.buildEnvelope(),
    })
  }

  clear(): Promise<unknown> {
    return this.publishCommand({
      type: CLEAR_COMMAND,
      ...this.buildEnvelope(),
    })
  }

  async close(): Promise<void> {
    await this.publisher.close()
  }

  /**
   * Returns the resolved topic ARN. Available only after `subscribe()` (or the
   * first publish) has fully completed; returns `undefined` while init is in
   * flight or before it has been triggered.
   */
  get topicArn(): string | undefined {
    return this.initialized ? this.publisher.publicTopicArn : undefined
  }

  private async publishCommand(command: GroupNotificationCommand): Promise<void> {
    await this.subscribe()
    await this.publisher.publish(command)
  }

  private buildEnvelope() {
    return {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      originUuid: this.serverUuid,
    }
  }
}
