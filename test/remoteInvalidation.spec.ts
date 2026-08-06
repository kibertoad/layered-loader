import { beforeEach, describe, expect, it } from 'vitest'
import { GroupLoader } from '../lib/GroupLoader.js'
import { Loader } from '../lib/Loader.js'
import { AbstractNotificationConsumer } from '../lib/notifications/AbstractNotificationConsumer.js'
import type { SynchronousCache, SynchronousGroupCache } from '../lib/types/SyncDataSources.js'

/**
 * Stands in for a real notification consumer (Redis pub/sub, SQS): it applies commands that arrived
 * from another node by calling the target cache it was handed, which is exactly what
 * RedisNotificationConsumer and SqsNotificationConsumer do.
 */
class FakeConsumer extends AbstractNotificationConsumer<string, SynchronousCache<string>> {
  async subscribe() {}
  async close() {}

  get target(): SynchronousCache<string> {
    return this.targetCache
  }
}

class FakeGroupConsumer extends AbstractNotificationConsumer<
  string,
  SynchronousGroupCache<string>
> {
  async subscribe() {}
  async close() {}

  get target(): SynchronousGroupCache<string> {
    return this.targetCache
  }
}

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve))

describe('applying invalidations that originated elsewhere', () => {
  describe('Loader', () => {
    let releaseLoad: (value: string) => void
    let loadsStarted: number
    let loader: Loader<string>
    let consumer: FakeConsumer

    beforeEach(() => {
      loadsStarted = 0
      consumer = new FakeConsumer('server-uuid')
      loader = new Loader<string>({
        inMemoryCache: { ttlInMsecs: 60_000, cacheId: 'test-cache' },
        notificationConsumer: consumer,
        dataSourceGetOneFn: () => {
          loadsStarted++
          return new Promise<string>((resolve) => {
            releaseLoad = resolve
          })
        },
      })
    })

    it('fences an in-flight load, so the pre-invalidation snapshot is not written back', async () => {
      const inFlight = loader.get('key')
      await flushMicrotasks()
      // the invalidation arrives from another node while the load is still running
      loader.applyRemoteInvalidationFor('key')
      releaseLoad('value-from-before-the-invalidation')

      // the caller that was already waiting still gets its value, as it does for a local invalidation
      expect(await inFlight).toBe('value-from-before-the-invalidation')
      await flushMicrotasks()

      expect(loader.getInMemoryOnly('key')).toBeUndefined()
      expect(loadsStarted).toBe(1)
    })

    it('fences an in-flight load when the invalidation arrives through a notification consumer', async () => {
      const inFlight = loader.get('key')
      await flushMicrotasks()
      consumer.target.delete('key')
      releaseLoad('value-from-before-the-invalidation')
      await inFlight
      await flushMicrotasks()

      expect(loader.getInMemoryOnly('key')).toBeUndefined()
    })

    it('applies a batch invalidation', async () => {
      const inFlight = loader.get('key')
      await flushMicrotasks()
      loader.applyRemoteInvalidationForMany(['key', 'other-key'])
      releaseLoad('value')
      await inFlight
      await flushMicrotasks()

      expect(loader.getInMemoryOnly('key')).toBeUndefined()
    })

    it('applies a cache-wide clear', async () => {
      const inFlight = loader.get('key')
      await flushMicrotasks()
      loader.applyRemoteInvalidation()
      releaseLoad('value')
      await inFlight
      await flushMicrotasks()

      expect(loader.getInMemoryOnly('key')).toBeUndefined()
    })

    it('applies a value set elsewhere, and an older in-flight load does not clobber it', async () => {
      const inFlight = loader.get('key')
      await flushMicrotasks()
      loader.applyRemoteValue('key', 'value-from-another-node')
      releaseLoad('older-value')
      await inFlight
      await flushMicrotasks()

      expect(loader.getInMemoryOnly('key')).toBe('value-from-another-node')
    })

    it('publishes nothing, so an applied invalidation is not echoed back onto the bus', async () => {
      const published: string[] = []
      const echoingLoader = new Loader<string>({
        inMemoryCache: { ttlInMsecs: 60_000 },
        notificationPublisher: {
          channel: 'test-channel',
          errorHandler: () => {},
          subscribe: async () => {},
          close: async () => {},
          set: async () => {},
          delete: async (key: string) => {
            published.push(key)
          },
          deleteMany: async () => {},
          clear: async () => {},
        },
        dataSourceGetOneFn: async () => 'value',
      })

      await echoingLoader.get('key')
      echoingLoader.applyRemoteInvalidationFor('key')
      await flushMicrotasks()
      expect(published).toEqual([])

      // ... whereas originating an invalidation locally does publish
      await echoingLoader.invalidateCacheFor('key')
      await flushMicrotasks()
      expect(published).toEqual(['key'])
    })

    it('exposes the in-memory reads unchanged through the consumer target', async () => {
      releaseLoad = () => {}
      const readLoader = new Loader<string>({
        inMemoryCache: { ttlInMsecs: 60_000, ttlLeftBeforeRefreshInMsecs: 100 },
        notificationConsumer: new FakeConsumer('server-uuid'),
        dataSourceGetOneFn: async () => 'value',
      })
      const target = (readLoader as unknown as { notificationConsumer: FakeConsumer })
        .notificationConsumer.target

      await readLoader.get('key')

      expect(target.ttlLeftBeforeRefreshInMsecs).toBe(100)
      expect(target.get('key')).toBe('value')
      expect(target.getMany(['key', 'missing'])).toEqual({
        resolvedValues: ['value'],
        unresolvedKeys: ['missing'],
      })
      expect(target.getExpirationTime('key')).toBeGreaterThan(Date.now())
      expect(target.resetTtl('key')).toBe(true)
      expect(target.resetTtl('missing')).toBe(false)

      target.set('key', 'replaced')
      expect(target.get('key')).toBe('replaced')
      target.deleteMany(['key'])
      expect(target.get('key')).toBeUndefined()
      target.set('key', 'again')
      target.clear()
      expect(target.get('key')).toBeUndefined()
    })
  })

  describe('GroupLoader', () => {
    let releaseLoad: (value: string) => void
    let loader: GroupLoader<string>
    let consumer: FakeGroupConsumer

    beforeEach(() => {
      consumer = new FakeGroupConsumer('server-uuid')
      loader = new GroupLoader<string>({
        inMemoryCache: { ttlInMsecs: 60_000 },
        notificationConsumer: consumer,
        dataSources: [
          {
            name: 'test',
            getFromGroup: () =>
              new Promise<string>((resolve) => {
                releaseLoad = resolve
              }),
            getManyFromGroup: async () => [],
          },
        ],
      })
    })

    it('fences an in-flight load, so the pre-invalidation snapshot is not written back', async () => {
      const inFlight = loader.get('key', 'group')
      await flushMicrotasks()
      loader.applyRemoteInvalidationFor('key', 'group')
      releaseLoad('value-from-before-the-invalidation')

      expect(await inFlight).toBe('value-from-before-the-invalidation')
      await flushMicrotasks()

      expect(loader.getInMemoryOnly('key', 'group')).toBeUndefined()
    })

    it('fences an in-flight load when the invalidation arrives through a notification consumer', async () => {
      const inFlight = loader.get('key', 'group')
      await flushMicrotasks()
      consumer.target.deleteFromGroup('key', 'group')
      releaseLoad('value')
      await inFlight
      await flushMicrotasks()

      expect(loader.getInMemoryOnly('key', 'group')).toBeUndefined()
    })

    it('applies a group-wide invalidation', async () => {
      const inFlight = loader.get('key', 'group')
      await flushMicrotasks()
      loader.applyRemoteInvalidationForGroup('group')
      releaseLoad('value')
      await inFlight
      await flushMicrotasks()

      expect(loader.getInMemoryOnly('key', 'group')).toBeUndefined()
    })

    it('applies a cache-wide clear', async () => {
      const inFlight = loader.get('key', 'group')
      await flushMicrotasks()
      loader.applyRemoteInvalidation()
      releaseLoad('value')
      await inFlight
      await flushMicrotasks()

      expect(loader.getInMemoryOnly('key', 'group')).toBeUndefined()
    })

    it('applies a value set elsewhere, and an older in-flight load does not clobber it', async () => {
      const inFlight = loader.get('key', 'group')
      await flushMicrotasks()
      loader.applyRemoteValue('key', 'value-from-another-node', 'group')
      releaseLoad('older-value')
      await inFlight
      await flushMicrotasks()

      expect(loader.getInMemoryOnly('key', 'group')).toBe('value-from-another-node')
    })

    it('exposes the in-memory reads unchanged through the consumer target', async () => {
      const readConsumer = new FakeGroupConsumer('server-uuid')
      const readLoader = new GroupLoader<string>({
        inMemoryCache: { ttlInMsecs: 60_000, ttlLeftBeforeRefreshInMsecs: 100 },
        notificationConsumer: readConsumer,
        dataSources: [
          {
            name: 'test',
            getFromGroup: async () => 'value',
            getManyFromGroup: async () => [],
          },
        ],
      })
      const target = readConsumer.target

      await readLoader.get('key', 'group')

      expect(target.ttlLeftBeforeRefreshInMsecs).toBe(100)
      expect(target.getFromGroup('key', 'group')).toBe('value')
      expect(target.getManyFromGroup(['key', 'missing'], 'group')).toEqual({
        resolvedValues: ['value'],
        unresolvedKeys: ['missing'],
      })
      expect(target.getExpirationTimeFromGroup('key', 'group')).toBeGreaterThan(Date.now())
      expect(target.resetTtlFromGroup('key', 'group')).toBe(true)
      expect(target.resetTtlFromGroup('missing', 'group')).toBe(false)

      target.setForGroup('key', 'replaced', 'group')
      expect(target.getFromGroup('key', 'group')).toBe('replaced')
      target.deleteGroup('group')
      expect(target.getFromGroup('key', 'group')).toBeUndefined()
      target.setForGroup('key', 'again', 'group')
      target.clear()
      expect(target.getFromGroup('key', 'group')).toBeUndefined()
    })
  })
})
