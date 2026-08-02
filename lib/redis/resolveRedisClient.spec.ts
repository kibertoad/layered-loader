import { describe, expect, it } from 'vitest'
import type { Redis, RedisOptions } from 'ioredis'
import { isClient } from './resolveRedisClient.js'

describe('isClient', () => {
  it('recognizes an instantiated client by its status field', () => {
    expect(isClient({ status: 'ready' } as unknown as Redis)).toBe(true)
  })

  it('rejects connection options', () => {
    const config: RedisOptions = { host: 'localhost', port: 6379 }
    expect(isClient(config)).toBe(false)
  })

  it('rejects nullish input instead of throwing', () => {
    expect(isClient(null)).toBe(false)
    expect(isClient(undefined)).toBe(false)
  })

  it('rejects primitives instead of throwing', () => {
    expect(isClient('redis://localhost')).toBe(false)
    expect(isClient(6379)).toBe(false)
  })
})
