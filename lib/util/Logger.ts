export type LogFn = {
  <T extends object>(obj: T, msg?: string, ...args: any[]): void
  (obj: unknown, msg?: string, ...args: any[]): void
  (msg: string, ...args: any[]): void
}

export type Logger = {
  error: LogFn
}

export const defaultLogger: Logger = {
  error: (msg: unknown) => {
    console.error(msg)
  },
}
