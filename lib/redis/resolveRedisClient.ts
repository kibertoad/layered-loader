import { createRequire } from 'node:module'
import type { Redis, RedisOptions } from 'ioredis'
import { enrichRedisConfig } from './enrichRedisConfig.js'

/**
 * `typeof import(...)` is a type query, not an import — it is erased at compile time and emits
 * nothing. It gives the lazy `require` below the module's real declarations, so the constructor
 * stays type-checked against `ioredis` rather than against a hand-written shape.
 */
type RedisConstructor = (typeof import('ioredis'))['Redis']

let cachedRedisConstructor: RedisConstructor | undefined

/**
 * `ioredis` is resolved on first use rather than imported at module scope, so that no file in
 * this package statically pulls the Redis client into the module graph. Consumers that pass
 * pre-instantiated clients (or that never construct one) never load it at all.
 */
function loadRedisConstructor(): RedisConstructor {
  if (!cachedRedisConstructor) {
    const require = createRequire(import.meta.url)
    cachedRedisConstructor = (require('ioredis') as typeof import('ioredis')).Redis
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
