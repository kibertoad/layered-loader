import { setTimeout } from 'timers/promises'
import { HitStatisticsRecord } from 'toad-cache'
import { describe } from 'vitest'
import type { InMemoryCacheConfiguration } from '../../lib/memory/InMemoryCache'
import { InMemoryGroupCache } from '../../lib/memory/InMemoryGroupCache'

const IN_MEMORY_CACHE_CONFIG = { ttlInMsecs: 999 } satisfies InMemoryCacheConfiguration

describe('InMemoryCache', () => {
  describe('setForGroup', () => {
    it('sets value after group has already expired', () => {
      const cache = new InMemoryGroupCache({
        maxGroups: 1,
        ttlInMsecs: 1,
      })
      cache.setForGroup('key', 'value', 'group')
      cache.setForGroup('key', 'value', 'group2')

      const preValue = cache.getFromGroup('key', 'group')
      expect(preValue).toBeUndefined()

      cache.setForGroup('key', 'value', 'group')
      const postValue = cache.getFromGroup('key', 'group')
      expect(postValue).toBe('value')
    })
  })

  describe('getFromGroup', () => {
    beforeEach(() => {
      vitest.useFakeTimers()
      vitest.setSystemTime(new Date('2024-01-02'))
    })

    afterEach(() => {
      vitest.useRealTimers()
    })

    it('Updates statistics if set', () => {
      const statistics = new HitStatisticsRecord()
      const cache = new InMemoryGroupCache({
        cacheId: 'MyCache',
        globalStatisticsRecord: statistics,
        cacheType: 'lru-object-statistics',
        groupCacheType: 'lru-object-statistics',
        maxGroups: 2,
        ttlInMsecs: 1,
      })
      cache.setForGroup('key', 'value', 'group')
      cache.setForGroup('key', 'value', 'group2')

      cache.getFromGroup('key', 'group')
      cache.setForGroup('key', 'value2', 'group')
      cache.getFromGroup('key', 'group')

      expect(statistics.records).toEqual({
        'MyCache (group group)': {
          '2024-01-02': {
            cacheSize: 1,
            emptyHits: 0,
            evictions: 0,
            expirations: 0,
            falsyHits: 0,
            hits: 2,
            invalidateAll: 0,
            invalidateOne: 0,
            misses: 0,
            sets: 2,
          },
        },
        'MyCache (group group2)': {
          '2024-01-02': {
            cacheSize: 1,
            emptyHits: 0,
            evictions: 0,
            expirations: 0,
            falsyHits: 0,
            hits: 0,
            invalidateAll: 0,
            invalidateOne: 0,
            misses: 0,
            sets: 1,
          },
        },
        'MyCache (groups)': {
          '2024-01-02': {
            cacheSize: 2,
            emptyHits: 0,
            evictions: 0,
            expirations: 0,
            falsyHits: 0,
            hits: 3,
            invalidateAll: 0,
            invalidateOne: 0,
            misses: 2,
            sets: 2,
          },
        },
      })
    })
  })

  describe('getManyFromGroup', () => {
    it('returns unresolved keys', () => {
      const cache = new InMemoryGroupCache({
        maxGroups: 1,
        ttlInMsecs: 10,
      })
      cache.setForGroup('key', 'value', 'group')
      cache.setForGroup('key2', 'value2', 'group2')

      const values = cache.getManyFromGroup(['key', 'key2'], 'group2')
      expect(values).toEqual({
        unresolvedKeys: ['key'],
        resolvedValues: ['value2'],
      })
    })

    it('resolves multiple values', () => {
      const cache = new InMemoryGroupCache({
        maxGroups: 2,
        ttlInMsecs: 100,
      })
      cache.setForGroup('key', 'value', 'group')
      cache.setForGroup('key', 'value', 'group2')
      cache.setForGroup('key2', 'value2', 'group2')

      const values = cache.getManyFromGroup(['key', 'key2'], 'group2')
      expect(values).toEqual({
        unresolvedKeys: [],
        resolvedValues: ['value', 'value2'],
      })
    })
  })

  describe('getExpirationTimeFromGroup', () => {
    it('returns undefined for non-existent entry', () => {
      const cache = new InMemoryGroupCache(IN_MEMORY_CACHE_CONFIG)

      const expiresAt = cache.getExpirationTimeFromGroup('dummy', 'group')

      expect(expiresAt).toBeUndefined()
    })

    it('returns past time for expired entry', async () => {
      const cache = new InMemoryGroupCache({
        ttlInMsecs: 1,
      })
      cache.setForGroup('key', 'value', 'group')
      await setTimeout(10)

      const expiresAt = cache.getExpirationTimeFromGroup('key', 'group')
      const timeLeft = expiresAt! - Date.now()

      expect(timeLeft < 0).toBe(true)
      expect(timeLeft > -30).toBe(true)
    })

    it('returns undefined after group has expired too', async () => {
      const cache = new InMemoryGroupCache({
        maxGroups: 1,
        ttlInMsecs: 1,
      })
      cache.setForGroup('key', 'value', 'group')
      cache.setForGroup('key', 'value', 'group2')
      await setTimeout(10)

      const expiresAt = cache.getExpirationTimeFromGroup('key', 'group')
      expect(expiresAt).toBeUndefined()
    })

    it('returns expiration time for existing entry', () => {
      const cache = new InMemoryGroupCache(IN_MEMORY_CACHE_CONFIG)
      cache.setForGroup('key', 'value', 'group')

      const expiresAt = cache.getExpirationTimeFromGroup('key', 'group')

      // should be 0 if everything happens in the same msec, but typically slightly differs
      const timeDifference = expiresAt! - IN_MEMORY_CACHE_CONFIG.ttlInMsecs - Date.now()
      expect(timeDifference < 10).toBe(true)
    })

    it('resets expiration time for reset entry', async () => {
      const cache = new InMemoryGroupCache({
        ttlInMsecs: 1000,
      })
      cache.setForGroup('key', 'value', 'group')
      await setTimeout(500)

      const expiresAtPre = cache.getExpirationTimeFromGroup('key', 'group')
      const timeLeftPre = expiresAtPre! - Date.now()

      cache.setForGroup('key', 'value', 'group')

      const expiresAtPost = cache.getExpirationTimeFromGroup('key', 'group')
      const timeLeftPost = expiresAtPost! - Date.now()

      expect(timeLeftPre < 520).toBe(true)
      expect(timeLeftPre > 480).toBe(true)
      expect(timeLeftPost < 1020).toBe(true)
      expect(timeLeftPost > 980).toBe(true)
    })
  })

  describe('clear', () => {
    it('clears values correctly', () => {
      const cache = new InMemoryGroupCache({
        ttlInMsecs: 9999,
      })
      cache.setForGroup('key', 'value', 'group')
      cache.setForGroup('key2', 'value2', 'group')

      cache.clear()

      const value1 = cache.getFromGroup('key', 'group')
      const value2 = cache.getFromGroup('key2', 'group')

      expect(value1).toBeUndefined()
      expect(value2).toBeUndefined()
    })
  })

  describe('deleteGroup', () => {
    it('deletes values matching the group pattern', () => {
      const cache = new InMemoryGroupCache(IN_MEMORY_CACHE_CONFIG)
      cache.setForGroup('key', 'value', 'team1')
      cache.setForGroup('key2', 'value2', 'team1')
      cache.setForGroup('key', 'value', 'team2')
      cache.setForGroup('key2', 'value2', 'team2')

      cache.deleteGroup('team2')

      const value1t1 = cache.getFromGroup('key', 'team1')
      const value2t1 = cache.getFromGroup('key2', 'team1')
      const value1t2 = cache.getFromGroup('key', 'team2')
      const value2t2 = cache.getFromGroup('key2', 'team2')

      expect(value1t1).toBe('value')
      expect(value2t1).toBe('value2')
      expect(value1t2).toBeUndefined()
      expect(value2t2).toBeUndefined()
    })
  })

  describe('deleteFromGroup', () => {
    it('deletes value from group', () => {
      const cache = new InMemoryGroupCache(IN_MEMORY_CACHE_CONFIG)
      cache.setForGroup('key', 'value', 'group1')
      cache.setForGroup('key2', 'value2', 'group1')
      cache.setForGroup('key', 'value', 'group2')
      cache.setForGroup('key2', 'value2', 'group2')

      cache.deleteFromGroup('key', 'group1')

      const value1group1 = cache.getFromGroup('key', 'group1')
      const value2group1 = cache.getFromGroup('key2', 'group1')
      const value1group2 = cache.getFromGroup('key', 'group2')
      const value2group2 = cache.getFromGroup('key2', 'group2')

      expect(value1group1).toBeUndefined()
      expect(value2group1).toBe('value2')
      expect(value1group2).toBe('value')
      expect(value2group2).toBe('value2')
    })
  })
})
