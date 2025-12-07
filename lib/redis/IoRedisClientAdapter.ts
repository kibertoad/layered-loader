import type Redis from 'ioredis'
import type { RedisClientInterface } from './RedisClientInterface'

/**
 * Adapter for ioredis client to conform to RedisClientInterface
 */
export class IoRedisClientAdapter implements RedisClientInterface {
  readonly clientType = 'ioredis' as const

  constructor(private readonly client: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key)
  }

  async set(key: string, value: string, expiryMode?: string, expiryValue?: number): Promise<string | null> {
    if (expiryMode && expiryValue !== undefined) {
      // ioredis accepts string expiry modes like 'PX', 'EX'
      return this.client.set(key, value, expiryMode as any, expiryValue)
    }
    return this.client.set(key, value)
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    return this.client.mget(keys)
  }

  async mset(keyValuePairs: string[]): Promise<string> {
    // ioredis expects variadic arguments: mset(key1, value1, key2, value2, ...)
    // Spread the flat array into variadic arguments
    return this.client.mset(...keyValuePairs)
  }

  async del(keys: string | string[]): Promise<number> {
    if (Array.isArray(keys)) {
      return this.client.del(...keys)
    }
    return this.client.del(keys)
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.client.hget(key, field)
  }

  async pttl(key: string): Promise<number> {
    return this.client.pttl(key)
  }

  async scan(cursor: string, matchPattern?: string): Promise<[string, string[]]> {
    if (matchPattern) {
      // @ts-ignore - ioredis scan signature
      return this.client.scan(cursor, 'MATCH', matchPattern)
    }
    // @ts-ignore
    return this.client.scan(cursor)
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key)
  }

  async multi(commands: any[]): Promise<any> {
    return this.client.multi(commands).exec()
  }

  async invokeScript(scriptCode: string, keys: string[], args: string[]): Promise<any> {
    // Use EVAL command to execute Lua script
    return this.client.eval(scriptCode, keys.length, ...keys, ...args)
  }

  async publish(channel: string, message: string): Promise<number> {
    return this.client.publish(channel, message)
  }

  async subscribe(channel: string, callback: (channel: string, message: string) => void): Promise<void> {
    await this.client.subscribe(channel)
    this.client.on('message', callback)
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.client.unsubscribe(channel)
  }

  on(event: string, callback: (...args: any[]) => void): void {
    this.client.on(event, callback)
  }

  async flushall(): Promise<string> {
    return this.client.flushall()
  }

  async quit(): Promise<void> {
    await this.client.quit()
  }

  disconnect(): void {
    this.client.disconnect()
  }

  // Expose underlying client for operations that require it (like defineCommand)
  getUnderlyingClient(): Redis {
    return this.client
  }
}

/**
 * Type guard to check if a client is an ioredis instance
 */
export function isIoRedisClient(client: unknown): client is Redis {
  return client !== null && typeof client === 'object' && 'status' in client
}
