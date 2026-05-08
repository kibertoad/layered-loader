import { randomUUID } from 'node:crypto'
import {
  AbstractSnsPublisher,
  type SNSCreationConfig,
  type SNSDependencies,
  type SNSPublisherOptions,
  type SNSTopicLocatorType,
} from '@message-queue-toolkit/sns'
import type { NotificationPublisher, PublisherErrorHandler } from 'layered-loader'
import {
  CLEAR_COMMAND,
  DELETE_COMMAND,
  DELETE_MANY_COMMAND,
  type NotificationCommand,
  NOTIFICATION_ID_FIELD,
  NOTIFICATION_SCHEMAS,
  NOTIFICATION_TIMESTAMP_FIELD,
  NOTIFICATION_TYPE_FIELD,
  SET_COMMAND,
} from './notificationSchemas.js'

const DEFAULT_PUBLISHER_ERROR_HANDLER: PublisherErrorHandler = (err, channel, logger) => {
  logger.error(`Error while publishing notification to channel ${channel}: ${err.message}`)
}

class SnsInvalidationPublisher extends AbstractSnsPublisher<NotificationCommand> {
  get publicTopicArn(): string {
    return this.topicArn
  }
}

export type SqsNotificationPublisherConfig =
  | { creationConfig: SNSCreationConfig; locatorConfig?: never }
  | { creationConfig?: never; locatorConfig: SNSTopicLocatorType }

export type SqsNotificationPublisherParams = {
  serverUuid: string
  errorHandler?: PublisherErrorHandler
  channel?: string
  dependencies: SNSDependencies
} & SqsNotificationPublisherConfig

export class SqsNotificationPublisher<LoadedValue>
  implements NotificationPublisher<LoadedValue>
{
  public readonly channel: string
  public readonly errorHandler: PublisherErrorHandler

  private readonly serverUuid: string
  private readonly publisher: SnsInvalidationPublisher
  private initPromise?: Promise<void>

  constructor(params: SqsNotificationPublisherParams) {
    this.serverUuid = params.serverUuid
    this.errorHandler = params.errorHandler ?? DEFAULT_PUBLISHER_ERROR_HANDLER
    this.channel = resolveChannelName(params)

    const options = {
      messageSchemas: NOTIFICATION_SCHEMAS,
      messageTypeResolver: { messageTypePath: NOTIFICATION_TYPE_FIELD },
      messageIdField: NOTIFICATION_ID_FIELD,
      messageTimestampField: NOTIFICATION_TIMESTAMP_FIELD,
      ...(params.creationConfig
        ? { creationConfig: params.creationConfig }
        : { locatorConfig: params.locatorConfig }),
    } as unknown as SNSPublisherOptions<NotificationCommand>

    this.publisher = new SnsInvalidationPublisher(params.dependencies, options)
  }

  async subscribe(): Promise<unknown> {
    if (!this.initPromise) {
      this.initPromise = this.publisher.init()
    }
    return this.initPromise
  }

  set(key: string, value: LoadedValue | null): Promise<unknown> {
    return this.publishCommand({
      type: SET_COMMAND,
      key,
      value,
      ...this.buildEnvelope(),
    })
  }

  delete(key: string): Promise<unknown> {
    return this.publishCommand({
      type: DELETE_COMMAND,
      key,
      ...this.buildEnvelope(),
    })
  }

  deleteMany(keys: string[]): Promise<unknown> {
    return this.publishCommand({
      type: DELETE_MANY_COMMAND,
      keys,
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
   * Returns the resolved topic ARN. Available only after subscribe() (or the first publish) has completed.
   */
  get topicArn(): string | undefined {
    return this.initPromise ? this.publisher.publicTopicArn : undefined
  }

  private async publishCommand(command: NotificationCommand): Promise<void> {
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

function resolveChannelName(params: SqsNotificationPublisherParams): string {
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
