import fastify from 'fastify'
import { LoadingOperation } from '../lib/LoadingOperation'
import { InMemoryCache } from '../lib/memory'
import { RedisCache } from '../lib/redis'
import { Redis, RedisOptions } from 'ioredis'
import { Loader } from '../lib/DataSources'
const autocannon = require('autocannon')

export const redisOptions: RedisOptions = {
  host: 'localhost',
  port: 6379,
  password: 'sOmE_sEcUrE_pAsS',
}
const redis = new Redis(redisOptions)

class DummyLoader implements Loader<string> {
  value: string | undefined | null
  name = 'Dummy loader'
  isCache = false

  constructor(returnedValue: string | undefined) {
    this.value = returnedValue
  }

  get(): Promise<string | undefined | null> {
    return Promise.resolve(this.value)
  }
}

const cache = new LoadingOperation([
  new InMemoryCache({
    ttlInMsecs: 5000,
  }),
  new RedisCache(redis, {
    ttlInMsecs: 60000,
  }),
  new DummyLoader('value'),
])

const app = fastify({
  logger: false,
  disableRequestLogging: true,
})

app.get('/', async () => {
  const value = await cache.get('1')
  return { value }
})

app.listen({
  host: 'localhost',
  port: 3000,
})

autocannon(
  {
    url: 'http://localhost:3000',
    connections: 900,
    pipelining: 1,
    duration: 30,
  },
  console.log
)
