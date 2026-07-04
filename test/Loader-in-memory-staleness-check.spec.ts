import { setTimeout } from 'node:timers/promises'
import { beforeEach, describe, expect, it, vitest } from 'vitest'
import { Loader } from '../lib/Loader'
import { CountingDataSource } from './fakes/CountingDataSource'

// These tests exercise the staleness probe running on the in-memory-only refresh path - no async
// cache is configured, so nothing here needs Redis.
describe('Loader in-memory-only staleness check', () => {
  beforeEach(() => {
    vitest.resetAllMocks()
  })

  it('bumps ttl without refetching when entry is still current', async () => {
    const loader = new CountingDataSource('value')
    const isEntryStillCurrentFn = vitest.fn(async () => true)

    const operation = new Loader<string>({
      inMemoryCache: { ttlInMsecs: 150, ttlLeftBeforeRefreshInMsecs: 75 },
      dataSources: [loader],
      isEntryStillCurrentFn,
    })
    expect(await operation.get('key')).toBe('value')
    expect(loader.counter).toBe(1)
    // @ts-expect-error accessing the protected in-memory cache for assertions
    const expirationTimePre = operation.inMemoryCache.getExpirationTime('key')

    await setTimeout(100)
    // kick off the staleness check
    expect(await operation.get('key')).toBe('value')
    for (let attempt = 0; attempt < 20 && isEntryStillCurrentFn.mock.calls.length < 1; attempt++) {
      await setTimeout(10)
    }
    expect(isEntryStillCurrentFn).toHaveBeenCalledWith('value', 'key')
    await setTimeout(10)

    // no full refetch happened, and the in-memory ttl was extended
    expect(loader.counter).toBe(1)
    // @ts-expect-error accessing the protected in-memory cache for assertions
    const expirationTimePost = operation.inMemoryCache.getExpirationTime('key')
    expect(expirationTimePre).toBeDefined()
    expect(expirationTimePost).toBeDefined()
    expect(expirationTimePost! > expirationTimePre!).toBe(true)

    // the entry survives past its original expiry and is still served from memory
    await setTimeout(80) // now beyond the original 150ms ttl
    expect(operation.getInMemoryOnly('key')).toBe('value')
  })

  it('falls back to full background refetch when entry is stale', async () => {
    const loader = new CountingDataSource('v1')
    const operation = new Loader<string>({
      inMemoryCache: { ttlInMsecs: 150, ttlLeftBeforeRefreshInMsecs: 75 },
      dataSources: [loader],
      isEntryStillCurrentFn: async () => false,
    })
    expect(await operation.get('key')).toBe('v1')
    expect(loader.counter).toBe(1)

    // the data source has moved on
    loader.value = 'v2'
    await setTimeout(100)
    // reads are never blocked - the stale-but-valid value is served while the refresh runs
    expect(await operation.get('key')).toBe('v1')
    for (let attempt = 0; attempt < 20 && loader.counter < 2; attempt++) {
      await setTimeout(10)
    }
    expect(loader.counter).toBe(2)
    // the freshly loaded value is now in the in-memory cache
    expect(operation.getInMemoryOnly('key')).toBe('v2')
  })

  it('treats a throwing staleness check as stale and refetches', async () => {
    const loader = new CountingDataSource('value')
    const loadErrorHandler = vitest.fn()

    const operation = new Loader<string>({
      inMemoryCache: { ttlInMsecs: 150, ttlLeftBeforeRefreshInMsecs: 75 },
      dataSources: [loader],
      isEntryStillCurrentFn: async () => {
        throw new Error('check failed')
      },
      loadErrorHandler,
    })
    expect(await operation.get('key')).toBe('value')
    expect(loader.counter).toBe(1)

    await setTimeout(100)
    // kick off the check, which throws
    expect(await operation.get('key')).toBe('value')
    for (let attempt = 0; attempt < 20 && loader.counter < 2; attempt++) {
      await setTimeout(10)
    }
    expect(loader.counter).toBe(2)
    expect(loadErrorHandler).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'check failed' }),
      'key',
      expect.objectContaining({ name: 'isEntryStillCurrentFn' }),
      expect.anything(),
    )
  })

  it('refetches when the entry disappears between the read and the ttl bump', async () => {
    const loader = new CountingDataSource('value')
    let finishCheck: (isCurrent: boolean) => void
    const checkPromise = new Promise<boolean>((resolve) => {
      finishCheck = resolve
    })
    const operation = new Loader<string>({
      inMemoryCache: { ttlInMsecs: 150, ttlLeftBeforeRefreshInMsecs: 75 },
      dataSources: [loader],
      isEntryStillCurrentFn: () => checkPromise,
    })
    expect(await operation.get('key')).toBe('value')
    expect(loader.counter).toBe(1)

    await setTimeout(100)
    // kick off the check, which hangs while we invalidate the entry concurrently
    expect(await operation.get('key')).toBe('value')
    await setTimeout(10)
    await operation.invalidateCacheFor('key')
    // the check now reports "still current", but the ttl bump fails because the entry is gone
    finishCheck!(true)
    for (let attempt = 0; attempt < 20 && loader.counter < 2; attempt++) {
      await setTimeout(10)
    }
    expect(loader.counter).toBe(2)
  })

  it('logs and swallows an error thrown by the fallback reload', async () => {
    let calls = 0
    const dataSource = {
      name: 'flaky',
      get: () => {
        calls++
        return calls === 1 ? Promise.resolve('value') : Promise.reject(new Error('boom'))
      },
      getMany: () => Promise.resolve([] as string[]),
    }
    const operation = new Loader<string>({
      inMemoryCache: { ttlInMsecs: 150, ttlLeftBeforeRefreshInMsecs: 75 },
      dataSources: [dataSource],
      isEntryStillCurrentFn: async () => false,
    })
    // @ts-expect-error spying on the protected logger
    const errorSpy = vitest.spyOn(operation.logger, 'error').mockImplementation(() => {})

    expect(await operation.get('key')).toBe('value')

    await setTimeout(100)
    // kick off the check (stale), whose fallback reload rejects
    expect(await operation.get('key')).toBe('value')
    for (let attempt = 0; attempt < 20 && errorSpy.mock.calls.length < 1; attempt++) {
      await setTimeout(10)
    }
    expect(errorSpy).toHaveBeenCalledWith('boom')
  })

  it('only runs a single staleness check for concurrent gets', async () => {
    const loader = new CountingDataSource('value')

    let finishCheck: (isCurrent: boolean) => void
    const checkPromise = new Promise<boolean>((resolve) => {
      finishCheck = resolve
    })
    const isEntryStillCurrentFn = vitest.fn(() => checkPromise)

    const operation = new Loader<string>({
      inMemoryCache: { ttlInMsecs: 9999, ttlLeftBeforeRefreshInMsecs: 9925 },
      dataSources: [loader],
      isEntryStillCurrentFn,
    })
    expect(await operation.get('key')).toBe('value')
    expect(loader.counter).toBe(1)

    await setTimeout(90)
    // kick off the check and keep it hanging while more gets come in
    expect(await operation.get('key')).toBe('value')
    expect(operation.getInMemoryOnly('key')).toBe('value')
    expect(operation.getInMemoryOnly('key')).toBe('value')
    await setTimeout(10)
    finishCheck!(true)
    await setTimeout(10)

    expect(isEntryStillCurrentFn).toHaveBeenCalledTimes(1)
    expect(loader.counter).toBe(1)

    // @ts-expect-error accessing the private refresh guard for assertions
    const isKeyRefreshing: Set<string> = operation.isKeyRefreshing
    expect(isKeyRefreshing.has('key')).toBe(false)
  })

  it('does not resurrect an entry invalidated while the fallback reload is in flight', async () => {
    let releaseLoad: (value: string) => void
    const secondLoad = new Promise<string>((resolve) => {
      releaseLoad = resolve
    })
    let calls = 0
    const dataSource = {
      name: 'controlled',
      get: () => {
        calls++
        return calls === 1 ? Promise.resolve('value') : secondLoad
      },
      getMany: () => Promise.resolve([] as string[]),
    }
    const operation = new Loader<string>({
      inMemoryCache: { ttlInMsecs: 150, ttlLeftBeforeRefreshInMsecs: 75 },
      dataSources: [dataSource],
      isEntryStillCurrentFn: async () => false, // always stale, so the fallback reload runs
    })
    expect(await operation.get('key')).toBe('value')

    await setTimeout(100)
    // kick off the check (stale) - the fallback reload is now in flight and hanging
    expect(await operation.get('key')).toBe('value')
    for (let attempt = 0; attempt < 20 && calls < 2; attempt++) {
      await setTimeout(10)
    }
    expect(calls).toBe(2)

    // invalidate while the fallback reload is still in flight, then let it resolve
    await operation.invalidateCacheFor('key')
    releaseLoad!('resurrected')
    await setTimeout(10)

    // the in-flight result must be fenced out - the entry stays evicted, not resurrected
    expect(operation.getInMemoryOnly('key')).toBeUndefined()
  })

  it('does not clobber a forceSetValue that lands while the fallback reload is in flight', async () => {
    let releaseLoad: (value: string) => void
    const secondLoad = new Promise<string>((resolve) => {
      releaseLoad = resolve
    })
    let calls = 0
    const dataSource = {
      name: 'controlled',
      get: () => {
        calls++
        return calls === 1 ? Promise.resolve('value') : secondLoad
      },
      getMany: () => Promise.resolve([] as string[]),
    }
    const operation = new Loader<string>({
      inMemoryCache: { ttlInMsecs: 150, ttlLeftBeforeRefreshInMsecs: 75 },
      dataSources: [dataSource],
      isEntryStillCurrentFn: async () => false,
    })
    expect(await operation.get('key')).toBe('value')

    await setTimeout(100)
    expect(await operation.get('key')).toBe('value')
    for (let attempt = 0; attempt < 20 && calls < 2; attempt++) {
      await setTimeout(10)
    }
    expect(calls).toBe(2)

    // an authoritative write lands while the stale reload is still in flight
    await operation.forceSetValue('key', 'forced')
    releaseLoad!('stale')
    await setTimeout(10)

    // the forced value survives - the in-flight stale reload is discarded, not written over it
    expect(operation.getInMemoryOnly('key')).toBe('forced')
  })
})
