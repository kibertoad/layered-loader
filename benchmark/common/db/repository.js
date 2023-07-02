const { AbstractRepository } = require('knex-repositories')

class UserRepository extends AbstractRepository {
  constructor(knex) {
    super(knex, {
      tableName: 'users',
      idColumn: 'id',
    })
  }
}

module.exports = {
  UserRepository,
}
