const knex = require('knex')
const { dbConfig } = require('./dbConfig.js')
const { UserRepository } = require('./repository.js')

function generateCompanies(amount) {
  const result = []
  for (let i = 1; i <= amount; i++) {
    result.push({
      companyId: i,
      name: `name${i}`,
    })
  }
  return result
}

async function seedWithData() {
  const knexInstance = knex({
    ...dbConfig,
    migrations: {
      directory: '../migrations',
    },
  })
  const repository = new UserRepository(knexInstance)

  const companies = generateCompanies(50000)
  await repository.createBulk(companies)

  await knexInstance.destroy()
  console.log('Finished seeding')
}

seedWithData()
