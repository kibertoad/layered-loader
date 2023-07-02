const autocannon = require('autocannon')

const { createFastifyApp, startApp } = require('./common/setup.js')
const { createLoadingOperation } = require('./layered-loader/caches.js')
const { getSpecs } = require('./common/results.js')
const { autocannonConfig } = require('./common/autocannonConfig.js')

const app = createFastifyApp()
const { cache, redis } = createLoadingOperation()

app.get('/', async () => {
  const value = await cache.get('1')
  return { value }
})

startApp(app)

autocannon(autocannonConfig, (err, result) => {
  console.log(result)
  return getSpecs()
    .then((systemSpecs) => {
      console.log(systemSpecs)

      return Promise.all([redis.quit(), app.close()])
    })
    .then(() => {
      console.log('Finished.')
    })
})
