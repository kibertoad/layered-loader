import type { GroupCache, GroupDataSource } from '../types/DataSources'

export class RedisExpirationTimeGroupDataSource implements GroupDataSource<number> {
  public readonly name = 'RedisExpirationTimeGroupedLoader'
  private readonly parentAsyncCache: GroupCache<any>

  constructor(asyncCache: GroupCache<any>) {
    this.parentAsyncCache = asyncCache
  }

  getFromGroup(key: string, group: string): Promise<number | undefined> {
    return this.parentAsyncCache.getExpirationTimeFromGroup(key, group)
  }

  /* c8 ignore next 3 */
  getManyFromGroup(): Promise<number[]> {
    throw new Error('Not supported')
  }
}
