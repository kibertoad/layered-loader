import autocannon from 'autocannon'

import { createFastifyApp, startApp } from './common/setup.js'
import { createLoadingOperation } from './layered-loader/caches.js'
import { getSpecs } from './common/results.js'
import { autocannonConfig } from './common/autocannonConfig.js'

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
