import { LoadingOperation } from '../../dist/lib/LoadingOperation.js'
import { InMemoryCache } from '../../dist/lib/memory/index.js'
import { RedisCache } from '../../dist/lib/redis/index.js'
import { createRedisConnection } from '../common/setup.js'

export class DummyLoader {
  value
  name = 'Dummy loader'
  isCache = false

  constructor(returnedValue) {
    this.value = returnedValue
  }

  get() {
    return Promise.resolve(this.value)
  }
}

export function createLoadingOperation() {
  const redis = createRedisConnection()
  return {
    redis,
    cache: new LoadingOperation([
      new InMemoryCache({
        ttlInMsecs: 5000,
      }),
      new RedisCache(redis, {
        ttlInMsecs: 60000,
      }),
      new DummyLoader('value'),
    ]),
  }
}
