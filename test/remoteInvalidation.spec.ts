import { beforeEach, describe, expect, it } from 'vitest'
import { GroupLoader } from '../lib/GroupLoader.js'
import { Loader } from '../lib/Loader.js'
import { AbstractNotificationConsumer } from '../lib/notifications/AbstractNotificationConsumer.js'
import type { Cache, CacheEntry, GroupCache } from '../lib/types/DataSources.js'
import type {
  GetManyResult,
  SynchronousCache,
  SynchronousGroupCache,
} from '../lib/types/SyncDataSources.js'

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

/**
 * An async cache tier whose entries are permanently inside their preemptive refresh window, so any
 * read of an existing entry schedules the async-tier background refresh. That refresh reloads
 * straight from the data sources instead of going through the fenced getAsyncOnlyResolved path,
 * which is why it needs a background write fence of its own.
 */
class AlwaysRefreshingCache implements Cache<string> {
  name = 'always-refreshing-cache'
  readonly ttlLeftBeforeRefreshInMsecs = 60_000
  public readonly storage = new Map<string, string | null>()

  readonly expirationTimeLoadingOperation = {
    get: () => Promise.resolve(Date.now() + 1),
  } as unknown as Cache<string>['expirationTimeLoadingOperation']

  get(key: string): Promise<string | undefined | null> {
    return Promise.resolve(this.storage.get(key))
  }

  set(key: string, value: string | null): Promise<void> {
    this.storage.set(key, value)
    return Promise.resolve()
  }

  delete(key: string): Promise<void> {
    this.storage.delete(key)
    return Promise.resolve()
  }

  deleteMany(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.storage.delete(key)
    }
    return Promise.resolve()
  }

  clear(): Promise<void> {
    this.storage.clear()
    return Promise.resolve()
  }

  close(): Promise<void> {
    return Promise.resolve()
  }

  getExpirationTime(): Promise<number> {
    return Promise.resolve(Date.now() + 1)
  }

  getMany(): Promise<GetManyResult<string>> {
    throw new Error('Not implemented')
  }

  setMany(_entries: readonly CacheEntry<string>[]): Promise<void> {
    throw new Error('Not implemented')
  }
}

/** Grouped counterpart of {@link AlwaysRefreshingCache}. */
class AlwaysRefreshingGroupCache implements GroupCache<string> {
  name = 'always-refreshing-group-cache'
  readonly ttlLeftBeforeRefreshInMsecs = 60_000
  public readonly storage = new Map<string, Map<string, string | null>>()

  readonly expirationTimeLoadingGroupedOperation = {
    get: () => Promise.resolve(Date.now() + 1),
  } as unknown as GroupCache<string>['expirationTimeLoadingGroupedOperation']

  private resolveGroup(group: string) {
    let groupStorage = this.storage.get(group)
    if (!groupStorage) {
      groupStorage = new Map()
      this.storage.set(group, groupStorage)
    }
    return groupStorage
  }

  getFromGroup(key: string, group: string): Promise<string | undefined | null> {
    return Promise.resolve(this.storage.get(group)?.get(key))
  }

  setForGroup(key: string, value: string | null, group: string): Promise<void> {
    this.resolveGroup(group).set(key, value)
    return Promise.resolve()
  }

  deleteFromGroup(key: string, group: string): Promise<void> {
    this.storage.get(group)?.delete(key)
    return Promise.resolve()
  }

  deleteGroup(group: string): Promise<void> {
    this.storage.delete(group)
    return Promise.resolve()
  }

  clear(): Promise<void> {
    this.storage.clear()
    return Promise.resolve()
  }

  close(): Promise<void> {
    return Promise.resolve()
  }

  getExpirationTimeFromGroup(): Promise<number> {
    return Promise.resolve(Date.now() + 1)
  }

  getManyFromGroup(): Promise<GetManyResult<string>> {
    throw new Error('Not implemented')
  }

  setManyForGroup(_entries: readonly CacheEntry<string>[], _group: string): Promise<void> {
    throw new Error('Not implemented')
  }
}

/**
 * A data source whose loads can be released one at a time, so a background refresh can be held open
 * while an invalidation arrives.
 */
const createHeldDataSource = () => {
  const releases: ((value: string) => void)[] = []
  let signalStarted!: () => void
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve
  })
  return {
    load: () => {
      const loadingPromise = new Promise<string>((resolve) => {
        releases.push(resolve)
      })
      signalStarted()
      return loadingPromise
    },
    /** Resolves once the first load has started. */
    started,
    release: (value: string) => {
      for (const resolve of releases.splice(0)) {
        resolve(value)
      }
    },
  }
}

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

    describe('async-tier background refresh', () => {
      let asyncCache: AlwaysRefreshingCache
      let dataSource: ReturnType<typeof createHeldDataSource>
      let refreshingLoader: Loader<string>

      beforeEach(() => {
        asyncCache = new AlwaysRefreshingCache()
        asyncCache.storage.set('key', 'stale-value')
        dataSource = createHeldDataSource()
        refreshingLoader = new Loader<string>({
          inMemoryCache: { ttlInMsecs: 60_000 },
          asyncCache,
          dataSourceGetOneFn: dataSource.load,
        })
      })

      it('writes the reloaded value into the in-memory tier when nothing invalidated it', async () => {
        expect(await refreshingLoader.get('key')).toBe('stale-value')
        await dataSource.started
        dataSource.release('fresh-value')
        await flushMicrotasks()

        expect(refreshingLoader.getInMemoryOnly('key')).toBe('fresh-value')
      })

      it('is fenced by a remote invalidation, so the pre-invalidation reload is not written back', async () => {
        expect(await refreshingLoader.get('key')).toBe('stale-value')
        await dataSource.started
        // the invalidation arrives from another node while the background refresh is still loading
        refreshingLoader.applyRemoteInvalidationFor('key')
        dataSource.release('value-loaded-before-the-invalidation')
        await flushMicrotasks()

        expect(refreshingLoader.getInMemoryOnly('key')).toBeUndefined()
      })

      it('is fenced by a batch remote invalidation', async () => {
        expect(await refreshingLoader.get('key')).toBe('stale-value')
        await dataSource.started
        refreshingLoader.applyRemoteInvalidationForMany(['key', 'other-key'])
        dataSource.release('value-loaded-before-the-invalidation')
        await flushMicrotasks()

        expect(refreshingLoader.getInMemoryOnly('key')).toBeUndefined()
      })

      it('is fenced by a remote value application, so the newer value is not clobbered', async () => {
        expect(await refreshingLoader.get('key')).toBe('stale-value')
        await dataSource.started
        refreshingLoader.applyRemoteValue('key', 'value-from-another-node')
        dataSource.release('value-loaded-before-the-invalidation')
        await flushMicrotasks()

        expect(refreshingLoader.getInMemoryOnly('key')).toBe('value-from-another-node')
      })

      it('is fenced by a remote cache-wide clear', async () => {
        expect(await refreshingLoader.get('key')).toBe('stale-value')
        await dataSource.started
        refreshingLoader.applyRemoteInvalidation()
        dataSource.release('value-loaded-before-the-invalidation')
        await flushMicrotasks()

        expect(refreshingLoader.getInMemoryOnly('key')).toBeUndefined()
      })

      it('is fenced by a locally originated invalidation too', async () => {
        expect(await refreshingLoader.get('key')).toBe('stale-value')
        await dataSource.started
        await refreshingLoader.invalidateCacheFor('key')
        dataSource.release('value-loaded-before-the-invalidation')
        await flushMicrotasks()

        expect(refreshingLoader.getInMemoryOnly('key')).toBeUndefined()
      })
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

    describe('async-tier background refresh', () => {
      let asyncCache: AlwaysRefreshingGroupCache
      let dataSource: ReturnType<typeof createHeldDataSource>
      let refreshingLoader: GroupLoader<string>

      beforeEach(() => {
        asyncCache = new AlwaysRefreshingGroupCache()
        dataSource = createHeldDataSource()
        refreshingLoader = new GroupLoader<string>({
          inMemoryCache: { ttlInMsecs: 60_000 },
          asyncCache,
          dataSources: [
            {
              name: 'test',
              getFromGroup: dataSource.load,
              getManyFromGroup: async () => [],
            },
          ],
        })
      })

      const seed = async (group: string) => {
        await asyncCache.setForGroup('key', 'stale-value', group)
      }

      it('writes the reloaded value into the in-memory tier when nothing invalidated it', async () => {
        await seed('group')
        expect(await refreshingLoader.get('key', 'group')).toBe('stale-value')
        await dataSource.started
        dataSource.release('fresh-value')
        await flushMicrotasks()

        expect(refreshingLoader.getInMemoryOnly('key', 'group')).toBe('fresh-value')
      })

      it('is fenced by a remote entry invalidation', async () => {
        await seed('group')
        expect(await refreshingLoader.get('key', 'group')).toBe('stale-value')
        await dataSource.started
        refreshingLoader.applyRemoteInvalidationFor('key', 'group')
        dataSource.release('value-loaded-before-the-invalidation')
        await flushMicrotasks()

        expect(refreshingLoader.getInMemoryOnly('key', 'group')).toBeUndefined()
      })

      it('is fenced by a remote group invalidation, and only for that group', async () => {
        await seed('group')
        await seed('other-group')
        expect(await refreshingLoader.get('key', 'group')).toBe('stale-value')
        expect(await refreshingLoader.get('key', 'other-group')).toBe('stale-value')
        await dataSource.started

        refreshingLoader.applyRemoteInvalidationForGroup('group')
        dataSource.release('value-loaded-before-the-invalidation')
        await flushMicrotasks()

        expect(refreshingLoader.getInMemoryOnly('key', 'group')).toBeUndefined()
        // the untouched group's refresh was never fenced, so it wrote its result as usual
        expect(refreshingLoader.getInMemoryOnly('key', 'other-group')).toBe(
          'value-loaded-before-the-invalidation',
        )
      })

      it('is fenced by a remote value application, so the newer value is not clobbered', async () => {
        await seed('group')
        expect(await refreshingLoader.get('key', 'group')).toBe('stale-value')
        await dataSource.started
        refreshingLoader.applyRemoteValue('key', 'value-from-another-node', 'group')
        dataSource.release('value-loaded-before-the-invalidation')
        await flushMicrotasks()

        expect(refreshingLoader.getInMemoryOnly('key', 'group')).toBe('value-from-another-node')
      })

      it('is fenced by a remote cache-wide clear', async () => {
        await seed('group')
        expect(await refreshingLoader.get('key', 'group')).toBe('stale-value')
        await dataSource.started
        refreshingLoader.applyRemoteInvalidation()
        dataSource.release('value-loaded-before-the-invalidation')
        await flushMicrotasks()

        expect(refreshingLoader.getInMemoryOnly('key', 'group')).toBeUndefined()
      })

      it('is fenced by a locally originated group invalidation too', async () => {
        await seed('group')
        expect(await refreshingLoader.get('key', 'group')).toBe('stale-value')
        await dataSource.started
        await refreshingLoader.invalidateCacheForGroup('group')
        dataSource.release('value-loaded-before-the-invalidation')
        await flushMicrotasks()

        expect(refreshingLoader.getInMemoryOnly('key', 'group')).toBeUndefined()
      })
    })
  })
})
