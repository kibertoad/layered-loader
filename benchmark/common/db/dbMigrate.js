const knex = require('knex')
const { dbConfig } = require('./dbConfig.js')

const knexInstance = knex({
  ...dbConfig,
  migrations: {
    directory: 'common/db/migrations',
  },
})

knexInstance.migrate.latest().then(function () {
  console.log('DB updated successfully.')
  return knexInstance.destroy()
})
