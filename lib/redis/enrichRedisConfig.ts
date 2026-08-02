import { lookup } from 'node:dns'
import type {
  RedisClusterConnectionOptions,
  RedisConnectionOptions,
  RedisReconnectOnError,
} from './RedisLike.js'

const defaultReconnectOnError: RedisReconnectOnError = (err: Error): boolean => {
  if (err.message.includes('READONLY')) return true
  return false
}

type DnsLookupCallback = (err: NodeJS.ErrnoException | null, address: string, family: number) => void

const cloudDnsLookup = (hostname: string, callback: DnsLookupCallback) => {
  lookup(hostname, { family: 4 }, callback)
}

/**
 * Both helpers are generic over the caller's own options type rather than typed against
 * `RedisOptions` / `ClusterOptions`, so `ioredis` is not needed to compile against them, and the
 * caller's exact type — including every field this package never touches — survives the round trip.
 *
 * The constraint is `object` rather than the shapes below, deliberately. Constraining to an
 * all-optional shape makes it a "weak type" and TypeScript rejects object literals that share no
 * property with it (`enrichRedisConfig({ host, port })`); adding an index signature to fix that
 * instead rejects interfaces, which never get an implicit one — so `RedisOptions` itself would stop
 * working. `object` accepts both, and the fields actually read are narrowed at the point of use.
 */
export const enrichRedisConfig = <T extends object>(config: T): T =>
  ({
    ...config,
    reconnectOnError: (config as RedisConnectionOptions).reconnectOnError ?? defaultReconnectOnError,
  }) as T

export const enrichRedisConfigOptimizedForCloud = <T extends object>(config: T): T => {
  const { dnsLookup, redisOptions } = config as RedisClusterConnectionOptions

  return {
    ...config,
    redisOptions: {
      ...redisOptions,
      reconnectOnError: redisOptions?.reconnectOnError ?? defaultReconnectOnError,
    },
    dnsLookup: dnsLookup ?? cloudDnsLookup,
  } as T
}
