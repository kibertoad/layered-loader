import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isClient, resolveRedisClient } from './resolveRedisClient.js'

describe('isClient', () => {
  it('recognises an object carrying a Redis client status', () => {
    expect(isClient({ status: 'ready' })).toBe(true)
  })

  it('rejects connection options', () => {
    expect(isClient({ host: 'localhost', port: 6379 })).toBe(false)
  })

  // The signature accepts `unknown`, so non-objects must return false rather than making the
  // `in` operator throw.
  it.each([[null], [undefined], ['redis://localhost'], [6379], [true]])(
    'returns false for the non-object value %p',
    (value) => {
      expect(isClient(value)).toBe(false)
    },
  )
})

describe('resolveRedisClient', () => {
  it('returns an already-constructed client untouched', () => {
    const client = { status: 'ready' }

    expect(resolveRedisClient(client as never)).toBe(client)
  })
})

describe('resolveRedisClient without the optional ioredis peer', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('reports an actionable error naming the missing peer dependency', async () => {
    const moduleNotFound = Object.assign(new Error("Cannot find module 'ioredis'"), {
      code: 'MODULE_NOT_FOUND',
    })
    vi.doMock('node:module', () => ({
      createRequire: () => () => {
        throw moduleNotFound
      },
    }))

    const { resolveRedisClient: resolveWithoutIoredis } = await import('./resolveRedisClient.js')

    expect(() => resolveWithoutIoredis({ host: 'localhost' })).toThrow(
      /requires the optional peer dependency "ioredis" to be installed/,
    )
    // The original resolution failure is preserved for anyone debugging the install.
    expect(() => resolveWithoutIoredis({ host: 'localhost' })).toThrow(
      expect.objectContaining({ cause: moduleNotFound }),
    )

    vi.doUnmock('node:module')
  })
})
