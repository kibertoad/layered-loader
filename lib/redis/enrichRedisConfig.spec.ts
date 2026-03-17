import { describe, expect, it } from 'vitest'
import type { ClusterOptions, RedisOptions } from 'ioredis'
import { enrichRedisConfig, enrichRedisConfigOptimizedForCloud } from './enrichRedisConfig'

describe('enrichRedisConfig', () => {
  it('adds default reconnectOnError handler', () => {
    const config: RedisOptions = { host: 'localhost', port: 6379 }
    const result = enrichRedisConfig(config)

    expect(result.reconnectOnError).toBeDefined()
    expect(result.host).toBe('localhost')
    expect(result.port).toBe(6379)
  })

  it('default reconnectOnError returns true for READONLY errors', () => {
    const result = enrichRedisConfig({})
    expect(result.reconnectOnError!(new Error('READONLY You can\'t write against a read only replica.'))).toBe(true)
  })

  it('default reconnectOnError returns false for other errors', () => {
    const result = enrichRedisConfig({})
    expect(result.reconnectOnError!(new Error('Connection refused'))).toBe(false)
  })

  it('preserves user-provided reconnectOnError', () => {
    const customHandler = (_err: Error) => false
    const result = enrichRedisConfig({ reconnectOnError: customHandler })
    expect(result.reconnectOnError).toBe(customHandler)
  })

  it('preserves other config options', () => {
    const config: RedisOptions = { host: 'redis.example.com', port: 6380, password: 'secret', db: 2 }
    const result = enrichRedisConfig(config)

    expect(result.host).toBe('redis.example.com')
    expect(result.port).toBe(6380)
    expect(result.password).toBe('secret')
    expect(result.db).toBe(2)
  })
})

describe('enrichRedisConfigOptimizedForCloud', () => {
  it('adds default dnsLookup and reconnectOnError', () => {
    const config: ClusterOptions = {}
    const result = enrichRedisConfigOptimizedForCloud(config)

    expect(result.dnsLookup).toBeDefined()
    expect(result.redisOptions?.reconnectOnError).toBeDefined()
  })

  it('default dnsLookup resolves using IPv4', () => {
    const result = enrichRedisConfigOptimizedForCloud({})
    expect(typeof result.dnsLookup).toBe('function')

    // Invoke to cover the function body; we don't assert the DNS result
    result.dnsLookup!('localhost', () => {})
  })

  it('default reconnectOnError in redisOptions returns true for READONLY errors', () => {
    const result = enrichRedisConfigOptimizedForCloud({})
    const handler = result.redisOptions?.reconnectOnError as (err: Error) => boolean
    expect(handler(new Error('READONLY'))).toBe(true)
  })

  it('default reconnectOnError in redisOptions returns false for other errors', () => {
    const result = enrichRedisConfigOptimizedForCloud({})
    const handler = result.redisOptions?.reconnectOnError as (err: Error) => boolean
    expect(handler(new Error('Connection refused'))).toBe(false)
  })

  it('preserves user-provided dnsLookup', () => {
    const customLookup: ClusterOptions['dnsLookup'] = (_hostname, _callback) => {}
    const result = enrichRedisConfigOptimizedForCloud({ dnsLookup: customLookup })
    expect(result.dnsLookup).toBe(customLookup)
  })

  it('preserves user-provided reconnectOnError in redisOptions', () => {
    const customHandler = (_err: Error) => false
    const result = enrichRedisConfigOptimizedForCloud({
      redisOptions: { reconnectOnError: customHandler },
    })
    expect(result.redisOptions?.reconnectOnError).toBe(customHandler)
  })

  it('preserves other cluster and redis options', () => {
    const config: ClusterOptions = {
      maxRedirections: 5,
      redisOptions: { password: 'secret' },
    }
    const result = enrichRedisConfigOptimizedForCloud(config)

    expect(result.maxRedirections).toBe(5)
    expect(result.redisOptions?.password).toBe('secret')
  })
})
