import { createRequire } from 'node:module'
import type { Redis, RedisOptions } from 'ioredis'
import { enrichRedisConfig } from './enrichRedisConfig.js'

type RedisConstructor = new (config: RedisOptions) => Redis

let cachedRedisConstructor: RedisConstructor | undefined

/**
 * `ioredis` is resolved on first use rather than imported at module scope, so that no file in
 * this package statically pulls the Redis client into the module graph. Consumers that pass
 * pre-instantiated clients (or that never construct one) never load it at all.
 */
function loadRedisConstructor(): RedisConstructor {
  if (!cachedRedisConstructor) {
    const require = createRequire(import.meta.url)
    cachedRedisConstructor = (require('ioredis') as { Redis: RedisConstructor }).Redis
  }
  return cachedRedisConstructor
}

export function isClient(maybeClient: unknown): maybeClient is Redis {
  return 'status' in (maybeClient as Redis)
}

/**
 * Returns the given client as-is, or instantiates one from the given options. Only the latter
 * branch needs `ioredis` to be loadable.
 */
export function resolveRedisClient(clientOrConfig: Redis | RedisOptions): Redis {
  if (isClient(clientOrConfig)) {
    return clientOrConfig
  }

  const RedisClient = loadRedisConstructor()
  return new RedisClient(enrichRedisConfig(clientOrConfig))
}
