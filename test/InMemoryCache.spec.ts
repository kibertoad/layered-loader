import { InMemoryCache, InMemoryCacheConfiguration } from '../lib/memory/InMemoryCache'

const IN_MEMORY_CACHE_CONFIG = { ttlInMsecs: 999 } satisfies InMemoryCacheConfiguration

describe('InMemoryCache', () => {
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

  describe('deleteGroup', () => {
    it('deletes values matching the group pattern', () => {
      const cache = new InMemoryCache(IN_MEMORY_CACHE_CONFIG)
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

  describe('deleteFromGroup', () => {
    it('deletes value from group', () => {
      const cache = new InMemoryCache(IN_MEMORY_CACHE_CONFIG)
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
