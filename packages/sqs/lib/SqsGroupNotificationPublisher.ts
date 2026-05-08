import { randomUUID } from 'node:crypto'
import {
  AbstractSnsPublisher,
  type SNSCreationConfig,
  type SNSDependencies,
  type SNSPublisherOptions,
  type SNSTopicLocatorType,
} from '@message-queue-toolkit/sns'
import type { GroupNotificationPublisher, PublisherErrorHandler } from 'layered-loader'
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

  constructor(params: SqsGroupNotificationPublisherParams) {
    this.serverUuid = params.serverUuid
    this.errorHandler = params.errorHandler ?? DEFAULT_PUBLISHER_ERROR_HANDLER
    this.channel = resolveChannelName(params)

    const options: SNSPublisherOptions<GroupNotificationCommand> = {
      messageSchemas: GROUP_NOTIFICATION_SCHEMAS as unknown as ReadonlyArray<
        // biome-ignore lint/suspicious/noExplicitAny: schema array is heterogeneous
        any
      >,
      messageTypeResolver: { messageTypePath: NOTIFICATION_TYPE_FIELD },
      messageIdField: NOTIFICATION_ID_FIELD,
      messageTimestampField: NOTIFICATION_TIMESTAMP_FIELD,
      ...(params.creationConfig
        ? { creationConfig: params.creationConfig }
        : { locatorConfig: params.locatorConfig }),
    } as SNSPublisherOptions<GroupNotificationCommand>

    this.publisher = new SnsGroupInvalidationPublisher(params.dependencies, options)
  }

  async subscribe(): Promise<unknown> {
    if (!this.initPromise) {
      this.initPromise = this.publisher.init()
    }
    return this.initPromise
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

  get topicArn(): string | undefined {
    return this.initPromise ? this.publisher.publicTopicArn : undefined
  }

  private async publishCommand(command: GroupNotificationCommand): Promise<void> {
    await this.subscribe()
    await this.publisher.publish(command as GroupNotificationCommand)
  }

  private buildEnvelope() {
    return {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      originUuid: this.serverUuid,
    }
  }
}

function resolveChannelName(params: SqsGroupNotificationPublisherParams): string {
  if (params.channel) {
    return params.channel
  }

  if (params.creationConfig?.topic?.Name) {
    return params.creationConfig.topic.Name
  }

  if (params.locatorConfig?.topicName) {
    return params.locatorConfig.topicName
  }

  if (params.locatorConfig?.topicArn) {
    return params.locatorConfig.topicArn
  }

  return 'sqs-notification-channel'
}
