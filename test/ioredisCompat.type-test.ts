/**
 * Compile-time guarantee that the vendored structural types in `lib/redis/RedisLike.ts` still match
 * the real `ioredis` declarations.
 *
 * `ioredis` is an optional peer dependency, so nothing in `lib/` may reference its types. That
 * freedom is only safe if something checks the vendored declarations against the real ones — this
 * file is that check, and `pnpm run lint:redis-compat` runs it in CI. If `ioredis` changes a
 * signature, this fails with the offending member named.
 *
 * It is deliberately type-only: nothing here runs.
 */
import type { ClusterOptions, Redis, RedisOptions } from 'ioredis'
import {
  enrichRedisConfig,
  enrichRedisConfigOptimizedForCloud,
} from '../lib/redis/enrichRedisConfig.js'
import type { RedisConstructorLike, RedisLike } from '../lib/redis/RedisLike.js'

declare const realClient: Redis

/** A real client must satisfy every member this package calls. */
export const clientIsCompatible: RedisLike = realClient

/** The real constructor must satisfy how `resolveRedisClient` invokes it. */
declare const RedisConstructor: typeof import('ioredis').Redis
export const constructorIsCompatible: RedisConstructorLike = RedisConstructor

/** The config helpers must round-trip real ioredis option types without widening them. */
declare const redisOptions: RedisOptions
declare const clusterOptions: ClusterOptions

export const enrichedIsStillRedisOptions: RedisOptions = enrichRedisConfig(redisOptions)
export const enrichedIsStillClusterOptions: ClusterOptions =
  enrichRedisConfigOptimizedForCloud(clusterOptions)

/** Fields this package never touches must survive with their original types. */
export const hostSurvives: string | undefined = enrichRedisConfig(redisOptions).host
export const maxRedirectionsSurvives: number | undefined =
  enrichRedisConfigOptimizedForCloud(clusterOptions).maxRedirections
