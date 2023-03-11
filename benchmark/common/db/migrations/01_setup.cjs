exports.up = async (knex) => {
  await knex.schema.createTable('users', (table) => {
    table.increments('id')
    table.integer('companyId')
    table.string('name')
  })
}

exports.down = async (knex) => {
  await knex.schema.dropTable('users')
}
