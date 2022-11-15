import { InMemoryCache } from '../lib/memory/InMemoryCache'

describe('InMemoryCache', () => {
  describe('clear', () => {
    it('clears values correctly', async () => {
      const cache = new InMemoryCache()
      await cache.set('key', 'value')
      await cache.set('key2', 'value2')

      await cache.clear()

      const value1 = await cache.get('key')
      const value2 = await cache.get('key2')

      expect(value1).toBeUndefined()
      expect(value2).toBeUndefined()
    })
  })

  describe('deleteGroup', () => {
    it('deletes values matching the group pattern', async () => {
      const cache = new InMemoryCache()
      await cache.setForGroup('key', 'value', 'team1')
      await cache.setForGroup('key2', 'value2', 'team1')
      await cache.setForGroup('key', 'value', 'team2')
      await cache.setForGroup('key2', 'value2', 'team2')

      await cache.deleteGroup('team2')

      const value1t1 = await cache.getFromGroup('key', 'team1')
      const value2t1 = await cache.getFromGroup('key2', 'team1')
      const value1t2 = await cache.getFromGroup('key', 'team2')
      const value2t2 = await cache.getFromGroup('key2', 'team2')

      expect(value1t1).toBe('value')
      expect(value2t1).toBe('value2')
      expect(value1t2).toBeUndefined()
      expect(value2t2).toBeUndefined()
    })
  })

  describe('delete', () => {
    it('deletes values correctly', async () => {
      const cache = new InMemoryCache()
      await cache.set('key', 'value')
      await cache.set('key2', 'value2')

      await cache.delete('key')

      const value1 = await cache.get('key')
      const value2 = await cache.get('key2')

      expect(value1).toBeUndefined()
      expect(value2).toBe('value2')
    })
  })
})
