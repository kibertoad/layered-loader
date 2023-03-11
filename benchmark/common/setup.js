import { Redis } from 'ioredis'
import fastify from 'fastify'

export const redisOptions = {
  host: 'localhost',
  port: 6379,
  password: 'sOmE_sEcUrE_pAsS',
}

export function createRedisConnection() {
  return new Redis(redisOptions)
}

export function createFastifyApp() {
  const app = fastify({
    logger: false,
    disableRequestLogging: true,
  })

  return app
}

export function startApp(app) {
  app.listen({
    host: 'localhost',
    port: 3000,
  })
}
