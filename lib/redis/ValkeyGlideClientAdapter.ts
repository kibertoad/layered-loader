import { Batch, Script, TimeUnit, type GlideClient } from '@valkey/valkey-glide'
import type { RedisClientInterface } from './RedisClientInterface'

/**
 * Adapter for valkey-glide client to conform to RedisClientInterface
 */
export class ValkeyGlideClientAdapter implements RedisClientInterface {
  readonly clientType = 'valkey-glide' as const
  private messageCallbacks: Map<string, Array<(channel: string, message: string) => void>>

  constructor(private readonly client: GlideClient) {
    // Check if client has a message router (set by createPubSubPair)
    // If so, use it; otherwise create a new one
    if ((client as any).__messageRouter) {
      this.messageCallbacks = (client as any).__messageRouter
    } else {
      this.messageCallbacks = new Map()
    }
  }

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
    return results.map((r) => {
      if (r === null) return null
      // GlideString can be string or Buffer
      return typeof r === 'string' ? r : r.toString()
    })
  }

  async mset(keyValuePairs: string[]): Promise<string> {
    // valkey-glide expects Record<string, string>
    // Convert flat array [key, value, key, value, ...] to {key: value, ...}
    const record: Record<string, string> = {}
    for (let i = 0; i < keyValuePairs.length; i += 2) {
      record[keyValuePairs[i]] = keyValuePairs[i + 1]
    }
    await this.client.mset(record)
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

  async incr(key: string): Promise<number> {
    return this.client.incr(key)
  }

  /**
   * Execute multiple commands in an atomic transaction using valkey-glide Batch API
   * @param commands - Array of command arrays, e.g. [['incr', 'key'], ['pexpire', 'key', '1000']]
   * @returns Array of command results
   */
  async multi(commands: any[][]): Promise<any> {
    // Create atomic batch (transaction)
    const batch = new Batch(true)

    for (const command of commands) {
      const [cmd, ...args] = command
      const cmdLower = cmd.toLowerCase()

      // Map common commands to batch methods
      if (cmdLower === 'incr') {
        batch.incr(args[0])
      } else if (cmdLower === 'pexpire') {
        batch.pexpire(args[0], Number(args[1]))
      } else if (cmdLower === 'set') {
        if (args.length === 4 && args[2] === 'PX') {
          // set key value PX milliseconds
          batch.set(args[0], args[1], {
            expiry: {
              type: TimeUnit.Milliseconds,
              count: Number(args[3]),
            },
          })
        } else {
          batch.set(args[0], args[1])
        }
      } else {
        throw new Error(`Unsupported batch command: ${cmd}`)
      }
    }

    // Execute batch atomically
    return this.client.exec(batch, true)
  }

  async invokeScript(scriptCode: string, keys: string[], args: string[]): Promise<any> {
    // Use valkey-glide Script class to execute Lua script
    const script = new Script(scriptCode)
    try {
      const result = await this.client.invokeScript(script, {
        keys,
        args,
      })
      return result
    } finally {
      // Clean up the script object
      script.release()
    }
  }

  async publish(channel: string, message: string): Promise<number> {
    // Note: valkey-glide has different argument order: publish(message, channel)
    return this.client.publish(message, channel)
  }

  async subscribe(channel: string, callback?: (channel: string, message: string) => void): Promise<void> {
    // For valkey-glide, subscriptions should be configured at client creation time
    // via pubSubSubscriptions. This method stores the callback for bridging.
    // The actual subscription must already be configured on the client.
    if (callback) {
      // Add this callback to the array of callbacks for this channel
      const callbacks = this.messageCallbacks.get(channel) || []
      callbacks.push(callback)
      this.messageCallbacks.set(channel, callbacks)
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    // Remove all callbacks for this channel
    this.messageCallbacks.delete(channel)
  }

  on(event: string, callback: (...args: any[]) => void): void {
    // For valkey-glide, the message callback is configured at client creation.
    // This method is for ioredis compatibility - we store callbacks that will
    // be invoked when the client's pubSubSubscriptions callback is triggered.
    if (event === 'message') {
      // Store a global message handler that delegates to channel-specific callbacks
      const messageHandler = callback as (channel: string, message: string) => void
      // Add to the array of global handlers
      const callbacks = this.messageCallbacks.get('__global__') || []
      callbacks.push(messageHandler)
      this.messageCallbacks.set('__global__', callbacks)
    }
  }

  async flushall(): Promise<string> {
    return this.client.flushall()
  }

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
 * Type guard to check if a client is a GlideClient instance
 */
export function isGlideClient(client: unknown): client is GlideClient {
  return client !== null && typeof client === 'object' && 'createClient' in (client.constructor as any)
}
