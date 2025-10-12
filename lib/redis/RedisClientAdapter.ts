import { TimeUnit, type GlideClient } from '@valkey/valkey-glide'
import type Redis from 'ioredis'

/**
 * Unified interface for Redis/Valkey client operations.
 * This abstraction allows the library to work with both ioredis and valkey-glide clients.
 * 
 * The adapter pattern isolates complexity in this file, keeping the rest of the codebase clean.
 */
export interface RedisClientInterface {
  // Basic key-value operations
  get(key: string): Promise<string | null>
  set(key: string, value: string, expiryMode?: string, expiryValue?: number): Promise<string | null>
  mget(keys: string[]): Promise<(string | null)[]>
  mset(keyValuePairs: Record<string, string>): Promise<string>
  del(keys: string | string[]): Promise<number>
  
  // Hash operations
  hget(key: string, field: string): Promise<string | null>
  
  // TTL operations
  pttl(key: string): Promise<number>
  
  // Scan operations
  scan(cursor: string, matchPattern?: string): Promise<[string, string[]]>
  
  // Advanced operations (may not be supported by all clients)
  incr?(key: string): Promise<number>
  multi?(commands: any[]): Promise<any>
  
  // Pub/Sub operations
  publish(channel: string, message: string): Promise<number>
  subscribe?(channel: string, callback: (channel: string, message: string) => void): Promise<void>
  unsubscribe?(channel: string): Promise<void>
  on?(event: string, callback: (...args: any[]) => void): void
  
  // Connection management
  quit(): Promise<void>
  disconnect(): void
  
  // Type identification
  readonly clientType: 'ioredis' | 'valkey-glide'
  
  // Access to underlying client for advanced operations
  getUnderlyingClient(): any
}

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

  async mset(keyValuePairs: Record<string, string>): Promise<string> {
    // Convert object to flat array for ioredis
    const flatArray: string[] = []
    for (const [key, value] of Object.entries(keyValuePairs)) {
      flatArray.push(key, value)
    }
    return this.client.mset(flatArray)
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
 * Adapter for valkey-glide client to conform to RedisClientInterface
 */
export class ValkeyGlideClientAdapter implements RedisClientInterface {
  readonly clientType = 'valkey-glide' as const
  
  constructor(private readonly client: GlideClient) {}

  async get(key: string): Promise<string | null> {
    const result = await this.client.get(key)
    if (result === null) return null
    return typeof result === 'string' ? result : result.toString()
  }

  async set(key: string, value: string, expiryMode?: string, expiryValue?: number): Promise<string | null> {
    if (expiryMode && expiryValue !== undefined) {
      // valkey-glide uses options object
      const result = await this.client.set(key, value, {
        expiry: {
          type: expiryMode === 'PX' ? TimeUnit.Milliseconds : TimeUnit.Seconds,
          count: expiryValue,
        },
      })
      if (result === null) return null
      return typeof result === 'string' ? result : result.toString()
    }
    const result = await this.client.set(key, value)
    if (result === null) return null
    return typeof result === 'string' ? result : result.toString()
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    const results = await this.client.mget(keys)
    return results.map(r => {
      if (r === null) return null
      return typeof r === 'string' ? r : r.toString()
    })
  }

  async mset(keyValuePairs: Record<string, string>): Promise<string> {
    await this.client.mset(keyValuePairs)
    return 'OK'
  }

  async del(keys: string | string[]): Promise<number> {
    if (typeof keys === 'string') {
      return this.client.del([keys])
    }
    return this.client.del(keys)
  }

  async hget(key: string, field: string): Promise<string | null> {
    const result = await this.client.hget(key, field)
    if (result === null) return null
    return typeof result === 'string' ? result : result.toString()
  }

  async pttl(key: string): Promise<number> {
    return this.client.pttl(key)
  }

  async scan(cursor: string, matchPattern?: string): Promise<[string, string[]]> {
    const options = matchPattern ? { match: matchPattern } : undefined
    const result = await this.client.scan(cursor, options)
    // Handle GlideString results (can be string or Buffer)
    const cursorStr = typeof result[0] === 'string' ? result[0] : result[0].toString()
    const keys = (result[1] as any[]).map((k: any) => typeof k === 'string' ? k : k.toString())
    return [cursorStr, keys]
  }

  // incr not implemented - would need to be added to interface if needed
  // multi not supported by valkey-glide in the same way

  async publish(channel: string, message: string): Promise<number> {
    // Note: valkey-glide has different argument order
    return this.client.publish(message, channel)
  }

  // Pub/Sub subscribe/unsubscribe not supported in the same way
  // valkey-glide requires a separate client with callback configuration

  async quit(): Promise<void> {
    await this.client.close()
  }

  disconnect(): void {
    this.client.close()
  }

  // Expose underlying client for operations that require it
  getUnderlyingClient(): GlideClient {
    return this.client
  }
}

/**
 * Type guard to check if a client is an ioredis instance
 */
export function isIoRedisClient(client: unknown): client is Redis {
  return client !== null && typeof client === 'object' && 'status' in client
}

/**
 * Type guard to check if a client is a GlideClient instance
 */
export function isGlideClient(client: unknown): client is GlideClient {
  return client !== null && typeof client === 'object' && 'createClient' in (client.constructor as any)
}

/**
 * Factory function to create the appropriate adapter based on client type
 */
export function createRedisAdapter(client: Redis | GlideClient): RedisClientInterface {
  if (isIoRedisClient(client)) {
    return new IoRedisClientAdapter(client)
  }
  return new ValkeyGlideClientAdapter(client as GlideClient)
}

/**
 * Type for client configuration
 */
export type RedisClientType = Redis | GlideClient
