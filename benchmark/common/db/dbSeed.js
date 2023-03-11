import knex from 'knex'
import { dbConfig } from './dbConfig.js'
import { UserRepository } from './repository.js'

export async function seedWithData() {
  const knexInstance = knex({
    ...dbConfig,
    migrations: {
      directory: '../migrations',
    },
  })
  const repository = new UserRepository(knexInstance)

  const companyId = 1
  const name = 'name'

  await repository.createBulk([
    {
      companyId,
      name,
    },
  ])

  await knexInstance.destroy()
  console.log('Finished seeding')
}

await seedWithData()
