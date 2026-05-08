import { z } from 'zod'

export const CLEAR_COMMAND = 'CLEAR'
export const DELETE_COMMAND = 'DELETE'
export const DELETE_MANY_COMMAND = 'DELETE_MANY'
export const SET_COMMAND = 'SET'

export const NOTIFICATION_TYPE_FIELD = 'type'
export const NOTIFICATION_ID_FIELD = 'id'
export const NOTIFICATION_TIMESTAMP_FIELD = 'timestamp'

const NOTIFICATION_BASE_SHAPE = {
  id: z.string(),
  timestamp: z.string(),
  originUuid: z.string(),
}

export const CLEAR_NOTIFICATION_SCHEMA = z.object({
  ...NOTIFICATION_BASE_SHAPE,
  type: z.literal(CLEAR_COMMAND),
})

export const DELETE_NOTIFICATION_SCHEMA = z.object({
  ...NOTIFICATION_BASE_SHAPE,
  type: z.literal(DELETE_COMMAND),
  key: z.string(),
})

export const DELETE_MANY_NOTIFICATION_SCHEMA = z.object({
  ...NOTIFICATION_BASE_SHAPE,
  type: z.literal(DELETE_MANY_COMMAND),
  keys: z.array(z.string()),
})

export const SET_NOTIFICATION_SCHEMA = z.object({
  ...NOTIFICATION_BASE_SHAPE,
  type: z.literal(SET_COMMAND),
  key: z.string(),
  value: z.unknown().nullable(),
})

export type ClearNotificationCommand = z.infer<typeof CLEAR_NOTIFICATION_SCHEMA>
export type DeleteNotificationCommand = z.infer<typeof DELETE_NOTIFICATION_SCHEMA>
export type DeleteManyNotificationCommand = z.infer<typeof DELETE_MANY_NOTIFICATION_SCHEMA>
export type SetNotificationCommand = z.infer<typeof SET_NOTIFICATION_SCHEMA>

export type NotificationCommand =
  | ClearNotificationCommand
  | DeleteNotificationCommand
  | DeleteManyNotificationCommand
  | SetNotificationCommand

export const NOTIFICATION_SCHEMAS = [
  CLEAR_NOTIFICATION_SCHEMA,
  DELETE_NOTIFICATION_SCHEMA,
  DELETE_MANY_NOTIFICATION_SCHEMA,
  SET_NOTIFICATION_SCHEMA,
] as const
