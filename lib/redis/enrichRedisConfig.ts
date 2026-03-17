import { lookup } from 'node:dns'
import type { RedisOptions } from 'ioredis'

const defaultReconnectOnError = (err: Error): boolean => {
  if (err.message.includes('READONLY')) return true
  return false
}

const cloudDnsLookup: RedisOptions['dnsLookup'] = (hostname, callback) => {
  lookup(hostname, { family: 4 }, callback)
}

export const enrichRedisConfig = (config: RedisOptions): RedisOptions => ({
  ...config,
  reconnectOnError: config.reconnectOnError ?? defaultReconnectOnError,
})

export const enrichRedisConfigOptimizedForCloud = (config: RedisOptions): RedisOptions => ({
  ...config,
  reconnectOnError: config.reconnectOnError ?? defaultReconnectOnError,
  dnsLookup: config.dnsLookup ?? cloudDnsLookup,
})
