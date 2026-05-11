import { z } from 'zod'
import {
  CLEAR_COMMAND,
  NOTIFICATION_ID_FIELD,
  NOTIFICATION_TIMESTAMP_FIELD,
  NOTIFICATION_TYPE_FIELD,
} from './notificationSchemas.js'

export const DELETE_GROUP_COMMAND = 'DELETE_GROUP'
export const DELETE_FROM_GROUP_COMMAND = 'DELETE_FROM_GROUP'

export {
  CLEAR_COMMAND,
  NOTIFICATION_ID_FIELD,
  NOTIFICATION_TIMESTAMP_FIELD,
  NOTIFICATION_TYPE_FIELD,
}

const NOTIFICATION_BASE_SHAPE = {
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  originUuid: z.string().uuid(),
}

export const CLEAR_GROUP_NOTIFICATION_SCHEMA = z.object({
  ...NOTIFICATION_BASE_SHAPE,
  type: z.literal(CLEAR_COMMAND),
})

export const DELETE_GROUP_NOTIFICATION_SCHEMA = z.object({
  ...NOTIFICATION_BASE_SHAPE,
  type: z.literal(DELETE_GROUP_COMMAND),
  group: z.string(),
})

export const DELETE_FROM_GROUP_NOTIFICATION_SCHEMA = z.object({
  ...NOTIFICATION_BASE_SHAPE,
  type: z.literal(DELETE_FROM_GROUP_COMMAND),
  key: z.string(),
  group: z.string(),
})

export type ClearGroupNotificationCommand = z.infer<typeof CLEAR_GROUP_NOTIFICATION_SCHEMA>
export type DeleteGroupNotificationCommand = z.infer<typeof DELETE_GROUP_NOTIFICATION_SCHEMA>
export type DeleteFromGroupNotificationCommand = z.infer<
  typeof DELETE_FROM_GROUP_NOTIFICATION_SCHEMA
>

export type GroupNotificationCommand =
  | ClearGroupNotificationCommand
  | DeleteGroupNotificationCommand
  | DeleteFromGroupNotificationCommand

export const GROUP_NOTIFICATION_SCHEMAS = [
  CLEAR_GROUP_NOTIFICATION_SCHEMA,
  DELETE_GROUP_NOTIFICATION_SCHEMA,
  DELETE_FROM_GROUP_NOTIFICATION_SCHEMA,
] as const
