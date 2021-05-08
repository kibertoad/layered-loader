import { LoadOperation } from '../lib/LoadOperation'
import { InMemoryCache } from '../lib/InMemoryCache'
import { DummyLoader } from './utils/DummyLoader'

describe('LoadOperation', () => {
  describe('load', () => {
    it('returns undefined when fails to resolve value', async () => {
      const operation = new LoadOperation([])

      const result = await operation.load('value')

      expect(result).toBe(undefined)
    })

    it('throws when fails to resolve value and flag is set', async () => {
      const operation = new LoadOperation([], {
        throwIfUnresolved: true,
      })

      await expect(() => {
        return operation.load('value')
      }).rejects.toThrow(/Failed to resolve value for key "value"/)
    })

    it('returns value when resolved via single loader', async () => {
      const cache = new InMemoryCache<string>()
      const operation = new LoadOperation<string>([cache])
      await cache.set('key', 'value')

      const result = await operation.load('key')

      expect(result).toBe('value')
    })

    it('returns value when resolved via multiple loaders', async () => {
      const cache1 = new InMemoryCache<string>()
      const cache2 = new InMemoryCache<string>()

      const operation = new LoadOperation<string>([cache1, cache2])
      await cache2.set('key', 'value')

      const result = await operation.load('key')

      expect(result).toBe('value')
    })

    it('updates upper level cache when resolving value downstream', async () => {
      const cache1 = new InMemoryCache<string>()
      const cache2 = new InMemoryCache<string>()

      const operation = new LoadOperation<string>([
        cache1,
        cache2,
        new DummyLoader(undefined),
        new DummyLoader('value'),
      ])
      const valuePre = await cache1.get('key')
      await operation.load('key')
      const valuePost = await cache1.get('key')
      const valuePost2 = await cache2.get('key')

      expect(valuePre).toBe(undefined)
      expect(valuePost).toBe('value')
      expect(valuePost2).toBe('value')
    })
  })
})
