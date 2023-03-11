import { AbstractRepository } from 'knex-repositories'

export class UserRepository extends AbstractRepository {
  constructor(knex) {
    super(knex, {
      tableName: 'users',
      idColumn: 'id',
    })
  }
}
