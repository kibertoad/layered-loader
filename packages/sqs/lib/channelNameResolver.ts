import type { SNSCreationConfig, SNSTopicLocatorType } from '@message-queue-toolkit/sns'

export type ChannelNameSource = {
  channel?: string
  creationConfig?: SNSCreationConfig
  locatorConfig?: SNSTopicLocatorType
}

const DEFAULT_CHANNEL_NAME = 'sqs-notification-channel'

/**
 * Derive a logical channel name (used in error messages and logs) from a
 * publisher params object that has either an explicit `channel`, a
 * `creationConfig.topic.Name`, or a `locatorConfig` with `topicName`/`topicArn`.
 */
export function resolveChannelName(source: ChannelNameSource): string {
  if (source.channel) return source.channel
  if (source.creationConfig?.topic?.Name) return source.creationConfig.topic.Name
  if (source.locatorConfig?.topicName) return source.locatorConfig.topicName
  if (source.locatorConfig?.topicArn) return source.locatorConfig.topicArn
  return DEFAULT_CHANNEL_NAME
}
