const { Loader } = require('../../dist/lib/Loader')
const { RedisCache } = require('../../dist/lib/redis/')
const { createRedisConnection } = require('../common/setup')

class DummyLoader {
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

function createLoadingOperation() {
  const redis = createRedisConnection()
  return {
    redis,
    cache: new Loader({
      inMemoryCache: {
        ttlInMsecs: 5000,
      },
      asyncCache: new RedisCache(redis, {
        ttlInMsecs: 60000,
      }),
      dataSources: [new DummyLoader('value')],
    }),
  }
}

module.exports = {
  DummyLoader,
  createLoadingOperation,
}
