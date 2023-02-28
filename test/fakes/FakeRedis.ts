import Redis, { Result } from 'ioredis'

function createLongDelayPromise() {
  return new Promise((resolve) => setTimeout(resolve, 9999999))
}

export class FakeRedis extends Redis {
  constructor() {
    super()
  }

  connect(): Promise<void> {
    return Promise.resolve()
  }

  get(): Result<any, any> {
    return createLongDelayPromise()
  }

  set(): Result<any, any> {
    return createLongDelayPromise()
  }

  del(): Result<number, any> {
    return createLongDelayPromise()
  }

  getGroupIndexAtomicWithTtl(): Result<number, any> {
    return createLongDelayPromise()
  }

  getGroupIndexAtomicWithoutTtl(): Result<number, any> {
    return createLongDelayPromise()
  }

  scan(): Result<number, any> {
    return createLongDelayPromise()
  }

  flushdb(): Result<any, any> {
    return createLongDelayPromise()
  }
}
