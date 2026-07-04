import { setTimeout } from 'node:timers/promises'
import { beforeEach, describe, expect, it, vitest } from 'vitest'
import { GroupLoader } from '../lib/GroupLoader'
import { CountingGroupedLoader } from './fakes/CountingGroupedLoader'
import type { User } from './types/testTypes'

const user1: User = {
  companyId: '1',
  userId: '1',
}

const user3: User = {
  companyId: '2',
  userId: '3',
}

const userValues = {
  [user1.companyId]: {
    [user1.userId]: user1,
  },
  [user3.companyId]: {
    [user3.userId]: user3,
  },
}

// These tests exercise the staleness probe running on the in-memory-only refresh path - no async
// cache is configured, so nothing here needs Redis.
describe('GroupLoader in-memory-only staleness check', () => {
  beforeEach(() => {
    vitest.resetAllMocks()
  })

  it('bumps ttl without refetching when entry is still current', async () => {
    const loader = new CountingGroupedLoader(userValues)
    const isEntryStillCurrentFn = vitest.fn(async () => true)

    const operation = new GroupLoader<User>({
      inMemoryCache: { ttlInMsecs: 150, ttlLeftBeforeRefreshInMsecs: 75 },
      dataSources: [loader],
      isEntryStillCurrentFn,
    })
    expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
    expect(loader.counter).toBe(1)
    // @ts-expect-error accessing the protected in-memory cache for assertions
    const expirationTimePre = operation.inMemoryCache.getExpirationTimeFromGroup(
      user1.userId,
      user1.companyId,
    )

    await setTimeout(100)
    // kick off the staleness check
    expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
    for (let attempt = 0; attempt < 20 && isEntryStillCurrentFn.mock.calls.length < 1; attempt++) {
      await setTimeout(10)
    }
    expect(isEntryStillCurrentFn).toHaveBeenCalledWith(user1, user1.userId, user1.companyId)
    await setTimeout(10)

    // no full refetch happened, and the in-memory ttl was extended
    expect(loader.counter).toBe(1)
    // @ts-expect-error accessing the protected in-memory cache for assertions
    const expirationTimePost = operation.inMemoryCache.getExpirationTimeFromGroup(
      user1.userId,
      user1.companyId,
    )
    expect(expirationTimePre).toBeDefined()
    expect(expirationTimePost).toBeDefined()
    expect(expirationTimePost! > expirationTimePre!).toBe(true)
  })

  it('does not touch other groups when bumping ttl', async () => {
    const loader = new CountingGroupedLoader(userValues)
    const operation = new GroupLoader<User>({
      inMemoryCache: { ttlInMsecs: 150, ttlLeftBeforeRefreshInMsecs: 75 },
      dataSources: [loader],
      isEntryStillCurrentFn: async () => true,
    })
    // prime both groups
    expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
    expect(await operation.get(user3.userId, user3.companyId)).toEqual(user3)
    expect(loader.counter).toBe(2)
    // @ts-expect-error accessing the protected in-memory cache for assertions
    const otherGroupExpirationPre = operation.inMemoryCache.getExpirationTimeFromGroup(
      user3.userId,
      user3.companyId,
    )

    await setTimeout(100)
    // only bump group user1.companyId
    expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
    await setTimeout(30)

    expect(loader.counter).toBe(2)
    // @ts-expect-error accessing the protected in-memory cache for assertions
    const otherGroupExpirationPost = operation.inMemoryCache.getExpirationTimeFromGroup(
      user3.userId,
      user3.companyId,
    )
    // the untouched group's ttl was not extended by the bump on the other group
    expect(otherGroupExpirationPost).toBe(otherGroupExpirationPre)
  })

  it('falls back to full background refetch when entry is stale', async () => {
    const loader = new CountingGroupedLoader(userValues)
    const operation = new GroupLoader<User>({
      inMemoryCache: { ttlInMsecs: 150, ttlLeftBeforeRefreshInMsecs: 75 },
      dataSources: [loader],
      isEntryStillCurrentFn: async () => false,
    })
    expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
    expect(loader.counter).toBe(1)

    await setTimeout(100)
    // reads are never blocked - the stale-but-valid value is served while the refresh runs
    expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
    for (let attempt = 0; attempt < 20 && loader.counter < 2; attempt++) {
      await setTimeout(10)
    }
    expect(loader.counter).toBe(2)
  })

  it('treats a throwing staleness check as stale and refetches', async () => {
    const loader = new CountingGroupedLoader(userValues)
    const loadErrorHandler = vitest.fn()

    const operation = new GroupLoader<User>({
      inMemoryCache: { ttlInMsecs: 150, ttlLeftBeforeRefreshInMsecs: 75 },
      dataSources: [loader],
      isEntryStillCurrentFn: async () => {
        throw new Error('check failed')
      },
      loadErrorHandler,
    })
    expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
    expect(loader.counter).toBe(1)

    await setTimeout(100)
    // kick off the check, which throws
    expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
    for (let attempt = 0; attempt < 20 && loader.counter < 2; attempt++) {
      await setTimeout(10)
    }
    expect(loader.counter).toBe(2)
    expect(loadErrorHandler).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'check failed' }),
      user1.userId,
      expect.objectContaining({ name: 'isEntryStillCurrentFn' }),
      expect.anything(),
    )
  })

  it('refetches when the entry disappears between the read and the ttl bump', async () => {
    const loader = new CountingGroupedLoader(userValues)
    let finishCheck: (isCurrent: boolean) => void
    const checkPromise = new Promise<boolean>((resolve) => {
      finishCheck = resolve
    })
    const operation = new GroupLoader<User>({
      inMemoryCache: { ttlInMsecs: 150, ttlLeftBeforeRefreshInMsecs: 75 },
      dataSources: [loader],
      isEntryStillCurrentFn: () => checkPromise,
    })
    expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
    expect(loader.counter).toBe(1)

    await setTimeout(100)
    // kick off the check, which hangs while we invalidate the entry concurrently
    expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
    await setTimeout(10)
    await operation.invalidateCacheFor(user1.userId, user1.companyId)
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
      getFromGroup: () => {
        calls++
        return calls === 1 ? Promise.resolve(user1) : Promise.reject(new Error('boom'))
      },
      getManyFromGroup: () => Promise.resolve([] as User[]),
    }
    const operation = new GroupLoader<User>({
      inMemoryCache: { ttlInMsecs: 150, ttlLeftBeforeRefreshInMsecs: 75 },
      dataSources: [dataSource],
      isEntryStillCurrentFn: async () => false,
    })
    // @ts-expect-error spying on the protected logger
    const errorSpy = vitest.spyOn(operation.logger, 'error').mockImplementation(() => {})

    expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)

    await setTimeout(100)
    // kick off the check (stale), whose fallback reload rejects
    expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
    for (let attempt = 0; attempt < 20 && errorSpy.mock.calls.length < 1; attempt++) {
      await setTimeout(10)
    }
    expect(errorSpy).toHaveBeenCalledWith('boom')
  })

  it('only runs a single staleness check for concurrent gets', async () => {
    const loader = new CountingGroupedLoader(userValues)

    let finishCheck: (isCurrent: boolean) => void
    const checkPromise = new Promise<boolean>((resolve) => {
      finishCheck = resolve
    })
    const isEntryStillCurrentFn = vitest.fn(() => checkPromise)

    const operation = new GroupLoader<User>({
      inMemoryCache: { ttlInMsecs: 9999, ttlLeftBeforeRefreshInMsecs: 9925 },
      dataSources: [loader],
      isEntryStillCurrentFn,
    })
    expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
    expect(loader.counter).toBe(1)

    await setTimeout(90)
    // kick off the check and keep it hanging while more gets come in
    expect(await operation.get(user1.userId, user1.companyId)).toEqual(user1)
    expect(operation.getInMemoryOnly(user1.userId, user1.companyId)).toEqual(user1)
    expect(operation.getInMemoryOnly(user1.userId, user1.companyId)).toEqual(user1)
    await setTimeout(10)
    finishCheck!(true)
    await setTimeout(10)

    expect(isEntryStillCurrentFn).toHaveBeenCalledTimes(1)
    expect(loader.counter).toBe(1)

    // @ts-expect-error accessing the private refresh guard for assertions
    const groupRefreshFlags: Map<string, Set<string>> = operation.groupRefreshFlags
    // The empty Set for the group should have been cleaned up
    expect(groupRefreshFlags.has(user1.companyId)).toBe(false)
  })
})
