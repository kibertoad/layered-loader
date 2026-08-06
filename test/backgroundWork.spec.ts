import { describe, expect, it } from 'vitest'
import { GroupLoader } from '../lib/GroupLoader.js'
import { Loader } from '../lib/Loader.js'
import type { GroupNotificationPublisher } from '../lib/notifications/GroupNotificationPublisher.js'
import type { NotificationPublisher } from '../lib/notifications/NotificationPublisher.js'
import type { BackgroundWorkMeta } from '../lib/types/BackgroundWork.js'

type Scheduled = { work: Promise<void>; meta: BackgroundWorkMeta }

const createRecordingScheduler = () => {
  const scheduled: Scheduled[] = []
  return {
    scheduled,
    scheduleBackgroundWork: (work: Promise<void>, meta: BackgroundWorkMeta) => {
      scheduled.push({ work, meta })
    },
    /** What a host on an isolate runtime does with ctx.waitUntil: await everything that was handed over. */
    drain: () => Promise.all(scheduled.map((entry) => entry.work)),
  }
}

const failingPublisher: NotificationPublisher<string> = {
  channel: 'test-channel',
  errorHandler: () => {},
  subscribe: async () => {},
  close: async () => {},
  set: async () => {
    throw new Error('publish failed')
  },
  delete: async () => {
    throw new Error('publish failed')
  },
  deleteMany: async () => {
    throw new Error('publish failed')
  },
  clear: async () => {
    throw new Error('publish failed')
  },
}

const failingGroupPublisher: GroupNotificationPublisher<string> = {
  channel: 'test-channel',
  errorHandler: () => {},
  subscribe: async () => {},
  close: async () => {},
  deleteFromGroup: async () => {
    throw new Error('publish failed')
  },
  deleteGroup: async () => {
    throw new Error('publish failed')
  },
  clear: async () => {
    throw new Error('publish failed')
  },
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('scheduleBackgroundWork', () => {
  it('is optional, and omitting it leaves background work detached as before', async () => {
    let loads = 0
    const loader = new Loader<string>({
      inMemoryCache: { ttlInMsecs: 100, ttlLeftBeforeRefreshInMsecs: 100 },
      dataSourceGetOneFn: async () => {
        loads++
        return 'value'
      },
    })

    expect(await loader.get('key')).toBe('value')
    await sleep(5)
    expect(await loader.get('key')).toBe('value')
    await sleep(20)

    expect(loads).toBe(2)
  })

  it('hands over preemptive in-memory refreshes, so the host can await quiescence', async () => {
    const scheduler = createRecordingScheduler()
    let loads = 0
    const loader = new Loader<string>({
      inMemoryCache: { ttlInMsecs: 100, ttlLeftBeforeRefreshInMsecs: 100, cacheId: 'users' },
      scheduleBackgroundWork: scheduler.scheduleBackgroundWork,
      dataSourceGetOneFn: async () => {
        loads++
        return `value-${loads}`
      },
    })

    expect(await loader.get('key')).toBe('value-1')
    await sleep(5)
    // this read is inside the refresh window, so it schedules a background reload
    expect(await loader.get('key')).toBe('value-1')

    expect(scheduler.scheduled).toHaveLength(1)
    expect(scheduler.scheduled[0].meta).toEqual({ cacheId: 'users', reason: 'refresh' })

    await scheduler.drain()
    expect(loads).toBe(2)
    expect(loader.getInMemoryOnly('key')).toBe('value-2')
  })

  it('hands over the staleness probe and its TTL bump', async () => {
    const scheduler = createRecordingScheduler()
    let probes = 0
    const loader = new Loader<string>({
      inMemoryCache: { ttlInMsecs: 100, ttlLeftBeforeRefreshInMsecs: 100 },
      scheduleBackgroundWork: scheduler.scheduleBackgroundWork,
      dataSourceGetOneFn: async () => 'value',
      isEntryStillCurrentFn: async () => {
        probes++
        return true
      },
    })

    await loader.get('key')
    await sleep(5)
    await loader.get('key')

    expect(scheduler.scheduled).toHaveLength(1)
    expect(scheduler.scheduled[0].meta.reason).toBe('refresh')

    await scheduler.drain()
    expect(probes).toBe(1)
  })

  it('hands over notification publishes', async () => {
    const scheduler = createRecordingScheduler()
    const published: string[] = []
    const loader = new Loader<string>({
      inMemoryCache: { ttlInMsecs: 60_000 },
      scheduleBackgroundWork: scheduler.scheduleBackgroundWork,
      notificationPublisher: {
        channel: 'test-channel',
        errorHandler: () => {},
        subscribe: async () => {},
        close: async () => {},
        set: async (key: string) => {
          published.push(`set:${key}`)
        },
        delete: async (key: string) => {
          published.push(`delete:${key}`)
        },
        deleteMany: async (keys: string[]) => {
          published.push(`deleteMany:${keys.join(',')}`)
        },
        clear: async () => {
          published.push('clear')
        },
      },
      dataSourceGetOneFn: async () => 'value',
    })

    await loader.invalidateCacheFor('key')
    await loader.invalidateCacheForMany(['a', 'b'])
    await loader.invalidateCache()
    await loader.forceSetValue('key', 'value')
    await loader.forceRefresh('key')

    expect(scheduler.scheduled).toHaveLength(5)
    expect(scheduler.scheduled.map((entry) => entry.meta.reason)).toEqual([
      'notification',
      'notification',
      'notification',
      'notification',
      'notification',
    ])
    expect(scheduler.scheduled[0].meta.cacheId).toBeUndefined()

    await scheduler.drain()
    expect(published).toEqual(['delete:key', 'deleteMany:a,b', 'clear', 'set:key', 'delete:key'])
  })

  it('never hands over a rejecting promise', async () => {
    const scheduler = createRecordingScheduler()
    const loader = new Loader<string>({
      inMemoryCache: { ttlInMsecs: 100, ttlLeftBeforeRefreshInMsecs: 100 },
      scheduleBackgroundWork: scheduler.scheduleBackgroundWork,
      notificationPublisher: failingPublisher,
      loadErrorHandler: () => {},
      dataSourceGetOneFn: async () => {
        throw new Error('data source is down')
      },
    })

    // a failing publish
    await loader.invalidateCacheFor('key')
    // a failing background refresh: seed the entry, then read it inside the refresh window
    await loader.forceSetValue('key', 'value')
    await sleep(5)
    await loader.get('key')

    expect(scheduler.scheduled.length).toBeGreaterThanOrEqual(2)
    // `ctx.waitUntil()` on a rejected promise fails the request that adopted it, so every promise
    // handed to the host has to settle fulfilled
    await expect(scheduler.drain()).resolves.toBeDefined()
  })

  it('works the same way for GroupLoader', async () => {
    const scheduler = createRecordingScheduler()
    let loads = 0
    const loader = new GroupLoader<string>({
      inMemoryCache: { ttlInMsecs: 100, ttlLeftBeforeRefreshInMsecs: 100, cacheId: 'users' },
      scheduleBackgroundWork: scheduler.scheduleBackgroundWork,
      dataSources: [
        {
          name: 'test',
          getFromGroup: async () => {
            loads++
            return `value-${loads}`
          },
          getManyFromGroup: async () => [],
        },
      ],
    })

    expect(await loader.get('key', 'group')).toBe('value-1')
    await sleep(5)
    expect(await loader.get('key', 'group')).toBe('value-1')

    expect(scheduler.scheduled).toHaveLength(1)
    expect(scheduler.scheduled[0].meta).toEqual({ cacheId: 'users', reason: 'refresh' })

    await scheduler.drain()
    expect(loads).toBe(2)
  })

  it('hands over the staleness probe and notification publishes for GroupLoader', async () => {
    const scheduler = createRecordingScheduler()
    let probes = 0
    const loader = new GroupLoader<string>({
      inMemoryCache: { ttlInMsecs: 100, ttlLeftBeforeRefreshInMsecs: 100 },
      scheduleBackgroundWork: scheduler.scheduleBackgroundWork,
      notificationPublisher: failingGroupPublisher,
      dataSources: [
        {
          name: 'test',
          getFromGroup: async () => 'value',
          getManyFromGroup: async () => [],
        },
      ],
      isEntryStillCurrentFn: async () => {
        probes++
        return true
      },
    })

    await loader.get('key', 'group')
    await sleep(5)
    await loader.get('key', 'group')
    await loader.invalidateCacheFor('key', 'group')
    await loader.invalidateCacheForGroup('group')

    expect(scheduler.scheduled.map((entry) => entry.meta.reason)).toEqual([
      'refresh',
      'notification',
      'notification',
    ])

    await expect(scheduler.drain()).resolves.toBeDefined()
    expect(probes).toBe(1)
  })
})
