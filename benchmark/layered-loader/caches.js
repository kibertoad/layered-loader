const { Loader } = require('../../dist/lib/Loader')
const { RedisCache } = require('../../dist/lib/redis/')
const { createRedisConnection } = require('../common/setup')
const { dbConfig } = require('../common/db/dbConfig')
const { knex } = require('knex')
const { UserRepository } = require('../common/db/repository')

class DbLoader {
  value
  name = 'Dummy loader'
  isCache = false

  constructor(repository) {
    this.repository = repository
  }

  get(id) {
    return this.repository.getById(id)
  }

  getMany(ids) {
    return this.repository.knex('users').select().whereIn('id', ids)
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
        json: true,
        ttlInMsecs: 60000,
      }),
      dataSources: [new DbLoader(new UserRepository(knex(dbConfig)))],
    }),
  }
}

module.exports = {
  DummyLoader: DbLoader,
  createLoadingOperation,
}
