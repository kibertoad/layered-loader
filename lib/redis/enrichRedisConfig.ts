import { lookup } from 'node:dns'
import type { ClusterOptions, RedisOptions } from 'ioredis'

const defaultReconnectOnError = (err: Error): boolean => {
  if (err.message.includes('READONLY')) return true
  return false
}

const cloudDnsLookup: ClusterOptions['dnsLookup'] = (hostname, callback) => {
  lookup(hostname, { family: 4 }, callback)
}

export const enrichRedisConfig = (config: RedisOptions): RedisOptions => ({
  ...config,
  reconnectOnError: config.reconnectOnError ?? defaultReconnectOnError,
})

export const enrichRedisConfigOptimizedForCloud = (config: ClusterOptions): ClusterOptions => ({
  ...config,
  redisOptions: {
    ...config.redisOptions,
    reconnectOnError: config.redisOptions?.reconnectOnError ?? defaultReconnectOnError,
  },
  dnsLookup: config.dnsLookup ?? cloudDnsLookup,
})
