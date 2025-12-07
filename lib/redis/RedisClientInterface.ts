import type { GlideClient } from '@valkey/valkey-glide'
import type Redis from 'ioredis'

/**
 * Unified interface for Redis/Valkey client operations.
 * This abstraction allows the library to work with both ioredis and valkey-glide clients.
 *
 * The adapter pattern isolates complexity, keeping the rest of the codebase clean.
 */
export interface RedisClientInterface {
  // Basic key-value operations
  get(key: string): Promise<string | null>
  set(key: string, value: string, expiryMode?: string, expiryValue?: number): Promise<string | null>
  mget(keys: string[]): Promise<(string | null)[]>
  mset(keyValuePairs: string[]): Promise<string>
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

  // Lua script execution
  invokeScript(scriptCode: string, keys: string[], args: string[]): Promise<any>

  // Pub/Sub operations
  publish(channel: string, message: string): Promise<number>
  subscribe?(channel: string, callback: (channel: string, message: string) => void): Promise<void>
  unsubscribe?(channel: string): Promise<void>
  on?(event: string, callback: (...args: any[]) => void): void

  // Server management
  flushall(): Promise<string>

  // Connection management
  quit(): Promise<void>
  disconnect(): void

  // Type identification
  readonly clientType: 'ioredis' | 'valkey-glide'

  // Access to underlying client for advanced operations
  getUnderlyingClient(): any
}

/**
 * Type for client configuration
 */
export type RedisClientType = Redis | GlideClient
