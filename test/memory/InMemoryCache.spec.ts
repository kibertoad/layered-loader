import type { InMemoryCacheConfiguration } from '../../lib/memory/InMemoryCache'
import { InMemoryCache } from '../../lib/memory/InMemoryCache'
import { setTimeout } from 'timers/promises'

const IN_MEMORY_CACHE_CONFIG = { ttlInMsecs: 999 } satisfies InMemoryCacheConfiguration

describe('InMemoryCache', () => {
  describe('set', () => {
    it('expires LRU', () => {
      const cache = new InMemoryCache({
        cacheType: 'lru-map',
        maxItems: 2,
        ttlInMsecs: 1,
      })
      cache.set('key', 'value')
      cache.set('key2', 'value2')

      cache.get('key')
      cache.set('key3', 'value3')

      const value1 = cache.get('key')
      const value2 = cache.get('key2')
      const value3 = cache.get('key3')

      expect(value1).toBe('value')
      expect(value2).toBeUndefined()
      expect(value3).toBe('value3')
    })

    it('expires LRU-object', () => {
      const cache = new InMemoryCache({
        cacheType: 'lru-object',
        maxItems: 2,
        ttlInMsecs: 5,
      })
      cache.set('key', 'value')
      cache.set('key2', 'value2')

      cache.get('key')
      cache.set('key3', 'value3')

      const value1 = cache.get('key')
      const value2 = cache.get('key2')
      const value3 = cache.get('key3')

      expect(value1).toBe('value')
      expect(value2).toBeUndefined()
      expect(value3).toBe('value3')
    })

    it('expires FIFO', () => {
      const cache = new InMemoryCache({
        cacheType: 'fifo-map',
        maxItems: 2,
        ttlInMsecs: 2,
      })
      cache.set('key', 'value')
      cache.set('key2', 'value2')

      cache.get('key')
      cache.set('key3', 'value3')

      const value1 = cache.get('key')
      const value2 = cache.get('key2')
      const value3 = cache.get('key3')

      expect(value1).toBeUndefined()
      expect(value2).toBe('value2')
      expect(value3).toBe('value3')
    })

    it('expires FIFO-Object', () => {
      const cache = new InMemoryCache({
        cacheType: 'fifo-object',
        maxItems: 2,
        ttlInMsecs: 5,
      })
      cache.set('key', 'value')
      cache.set('key2', 'value2')

      cache.get('key')
      cache.set('key3', 'value3')

      const value1 = cache.get('key')
      const value2 = cache.get('key2')
      const value3 = cache.get('key3')

      expect(value1).toBeUndefined()
      expect(value2).toBe('value2')
      expect(value3).toBe('value3')
    })

    it('defaults to infinite ttl', async () => {
      const cache = new InMemoryCache({
        ttlInMsecs: undefined,
      })
      cache.set('key', 'value')

      const ttl = cache.getExpirationTime('key')

      expect(ttl).toBe(0)
    })
  })

  describe('getExpirationTime', () => {
    it('returns undefined for non-existent entry', () => {
      const cache = new InMemoryCache(IN_MEMORY_CACHE_CONFIG)

      const expiresAt = cache.getExpirationTime('dummy')

      expect(expiresAt).toBeUndefined()
    })

    it('returns past time for expired entry', async () => {
      const cache = new InMemoryCache({
        ttlInMsecs: 1,
      })
      cache.set('key', 'value')
      await setTimeout(10)

      const expiresAt = cache.getExpirationTime('key')
      const timeLeft = expiresAt! - Date.now()

      expect(timeLeft < 0).toBe(true)
      expect(timeLeft > -30).toBe(true)
    })

    it('returns expiration time for existing entry', () => {
      const cache = new InMemoryCache(IN_MEMORY_CACHE_CONFIG)
      cache.set('key', 'value')

      const expiresAt = cache.getExpirationTime('key')

      // should be 0 if everything happens in the same msec, but typically slightly differs
      const timeDifference = expiresAt! - IN_MEMORY_CACHE_CONFIG.ttlInMsecs - Date.now()
      expect(timeDifference < 10).toBe(true)
    })

    it('resets expiration time for reset entry', async () => {
      const cache = new InMemoryCache({
        ttlInMsecs: 1000,
      })
      cache.set('key', 'value')
      await setTimeout(500)

      const expiresAtPre = cache.getExpirationTime('key')
      const timeLeftPre = expiresAtPre! - Date.now()

      cache.set('key', 'value')

      const expiresAtPost = cache.getExpirationTime('key')
      const timeLeftPost = expiresAtPost! - Date.now()

      expect(timeLeftPre < 520).toBe(true)
      expect(timeLeftPre > 480).toBe(true)
      expect(timeLeftPost < 1020).toBe(true)
      expect(timeLeftPost > 980).toBe(true)
    })
  })

  describe('clear', () => {
    it('clears values correctly', () => {
      const cache = new InMemoryCache({
        ttlInMsecs: 9999,
      })
      cache.set('key', 'value')
      cache.set('key2', 'value2')

      cache.clear()

      const value1 = cache.get('key')
      const value2 = cache.get('key2')

      expect(value1).toBeUndefined()
      expect(value2).toBeUndefined()
    })
  })

  describe('delete', () => {
    it('deletes value', () => {
      const cache = new InMemoryCache(IN_MEMORY_CACHE_CONFIG)
      cache.set('key', 'value')
      cache.set('key2', 'value2')

      cache.delete('key')

      const value1 = cache.get('key')
      const value2 = cache.get('key2')

      expect(value1).toBeUndefined()
      expect(value2).toBe('value2')
    })
  })
})
