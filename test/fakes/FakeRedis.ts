import Redis, { Callback, RedisKey, Result } from 'ioredis'

function createLongDelayPromise() {
  return new Promise((resolve) => setTimeout(resolve, 9999999))
}

export class FakeRedis extends Redis {
  constructor() {
    super()
  }

  connect(callback?: Callback<void>): Promise<void> {
    return Promise.resolve()
  }

  get(key: RedisKey, callback?: Callback<string | null>): Result<any, any> {
    return createLongDelayPromise()
  }

  set(key: RedisKey, value: string | Buffer | number): Result<any, any> {
    return createLongDelayPromise()
  }

  del(...args): Result<number, any> {
    return createLongDelayPromise()
  }

  flushdb(): Result<any, any> {
    return createLongDelayPromise()
  }
}
