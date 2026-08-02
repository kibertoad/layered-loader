const { Redis } = require('ioredis')
const fastify = require('fastify')

const redisOptions = {
  host: 'localhost',
  port: 6379,
  password: 'sOmE_sEcUrE_pAsS',
}

function createRedisConnection() {
  return new Redis(redisOptions)
}

function createFastifyApp() {
  // `logger: false` already disables request logging; the separate
  // `disableRequestLogging` option is deprecated as of fastify 5.
  const app = fastify({
    logger: false,
  })

  return app
}

function startApp(app) {
  app.listen({
    host: 'localhost',
    port: 3000,
  })
}

module.exports = {
  createFastifyApp,
  createRedisConnection,
  startApp,
  redisOptions,
}
