import Redis from 'ioredis'
import { RedisCache } from '../lib/redis/RedisCache'
import { FakeRedis } from './fakes/FakeRedis'

describe('RedisCache timeout', () => {
  let redis: Redis
  beforeEach(async () => {
    jest.useFakeTimers()
    redis = new FakeRedis()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  describe('get', () => {
    it('handles timeout correctly', async () => {
      const cache = new RedisCache(redis, {
        json: true,
        timeoutInMsecs: 25000,
        prefix: 'cache',
      })

      const promise = cache.get('dummy')
      jest.advanceTimersByTime(30000)

      await expect(promise).rejects.toThrow('Redis timeout')
    })
  })

  describe('set', () => {
    it('handles timeout correctly', async () => {
      const cache = new RedisCache(redis, {
        json: true,
        timeoutInMsecs: 25000,
        prefix: 'cache',
      })

      const promise = cache.set('dummy', 'dummy')
      jest.advanceTimersByTime(30000)

      await expect(promise).rejects.toThrow('Redis timeout')
    })
  })

  describe('delete', () => {
    it('handles timeout correctly', async () => {
      const cache = new RedisCache(redis, {
        json: true,
        timeoutInMsecs: 25000,
        prefix: 'cache',
      })

      const promise = cache.delete('dummy')
      jest.advanceTimersByTime(30000)

      await expect(promise).rejects.toThrow('Redis timeout')
    })
  })

  describe('clear', () => {
    it('handles timeout correctly', async () => {
      const cache = new RedisCache(redis, {
        json: true,
        timeoutInMsecs: 25000,
        prefix: 'cache',
      })

      const promise = cache.clear()
      jest.advanceTimersByTime(30000)

      await expect(promise).rejects.toThrow('Redis timeout')
    })
  })
})
