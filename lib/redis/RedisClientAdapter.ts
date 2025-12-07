import type { GlideClient } from '@valkey/valkey-glide'
import type Redis from 'ioredis'
import { IoRedisClientAdapter, isIoRedisClient } from './IoRedisClientAdapter'
import type { RedisClientInterface } from './RedisClientInterface'
import { ValkeyGlideClientAdapter } from './ValkeyGlideClientAdapter'

// Re-export everything for backward compatibility
export { IoRedisClientAdapter, isIoRedisClient } from './IoRedisClientAdapter'
export { RedisClientInterface, RedisClientType } from './RedisClientInterface'
export { isGlideClient, ValkeyGlideClientAdapter } from './ValkeyGlideClientAdapter'

/**
 * Factory function to create the appropriate adapter based on client type
 */
export function createRedisAdapter(client: Redis | GlideClient): RedisClientInterface {
  if (isIoRedisClient(client)) {
    return new IoRedisClientAdapter(client)
  }
  return new ValkeyGlideClientAdapter(client as GlideClient)
}
