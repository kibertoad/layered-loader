import { createRequire } from 'node:module'
import type { RedisConnectionOptions, RedisConstructorLike, RedisLike } from './RedisLike.js'
import { enrichRedisConfig } from './enrichRedisConfig.js'

let cachedRedisConstructor: RedisConstructorLike | undefined

/**
 * `ioredis` is an optional peer dependency, resolved on first use rather than imported at module
 * scope. No file in this package pulls it into the module graph, so consumers who pass their own
 * clients — or who never touch Redis at all — do not need it installed.
 */
function loadRedisConstructor(): RedisConstructorLike {
  if (!cachedRedisConstructor) {
    const require = createRequire(import.meta.url)
    try {
      cachedRedisConstructor = (require('ioredis') as { Redis: RedisConstructorLike }).Redis
    } catch (err) {
      throw new Error(
        'Constructing a Redis client from connection options requires the optional peer dependency "ioredis" to be installed. Install it, or pass an already-constructed client instead.',
        { cause: err },
      )
    }
  }
  return cachedRedisConstructor
}

export function isClient(maybeClient: unknown): maybeClient is RedisLike {
  return 'status' in (maybeClient as RedisLike)
}

/**
 * Returns the given client as-is, or instantiates one from the given options. Only the latter
 * branch needs `ioredis` to be installed.
 */
export function resolveRedisClient(clientOrConfig: RedisLike | RedisConnectionOptions): RedisLike {
  if (isClient(clientOrConfig)) {
    return clientOrConfig
  }

  const RedisClient = loadRedisConstructor()
  return new RedisClient(enrichRedisConfig(clientOrConfig))
}
