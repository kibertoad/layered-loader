import type { Result } from 'ioredis'
import Redis from 'ioredis'

function createLongDelayPromise() {
  return new Promise((resolve) => setTimeout(resolve, 9999999))
}

export class FakeThrowingRedis extends Redis {
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

  getOrSetZeroWithTtl(): Result<number, any> {
    return createLongDelayPromise()
  }

  getOrSetZeroWithoutTtl(): Result<number, any> {
    return createLongDelayPromise()
  }

  scan(): Result<number, any> {
    return createLongDelayPromise()
  }

  flushdb(): Result<any, any> {
    return createLongDelayPromise()
  }

  async publish(): Promise<number> {
    throw new Error('Operation has failed')
  }
}
