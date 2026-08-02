import { Redis, type RedisOptions } from 'ioredis'
import { enrichRedisConfig } from './enrichRedisConfig.js'

/**
 * Instantiated clients expose a `status` field; `RedisOptions` objects never do. Guarded against
 * non-objects so that a `null`/`undefined` config surfaces as a normal "not a client" result
 * rather than a bare `TypeError: Cannot use 'in' operator` thrown from here.
 */
export function isClient(maybeClient: unknown): maybeClient is Redis {
  return typeof maybeClient === 'object' && maybeClient !== null && 'status' in maybeClient
}

/**
 * Returns the given client as-is, or instantiates one from the given options.
 *
 * This is the only place in the package that uses `Redis` as a value, and it is reachable only
 * from the `layered-loader/redis` entrypoint — nothing in `layered-loader/core` imports it.
 *
 * The import is deliberately static rather than lazily `require`d: bundlers cannot see through
 * `createRequire`, so a lazy require would silently omit `ioredis` from bundles that do need it
 * (failing at runtime only on the branch that constructs a client), while `sideEffects: false`
 * already lets them drop it from bundles that do not.
 */
export function resolveRedisClient(clientOrConfig: Redis | RedisOptions): Redis {
  if (isClient(clientOrConfig)) {
    return clientOrConfig
  }

  return new Redis(enrichRedisConfig(clientOrConfig))
}
