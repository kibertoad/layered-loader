import type { Cache, DataSource } from '../types/DataSources'

export class RedisExpirationTimeDataSource implements DataSource<number> {
  public readonly name = 'RedisExpirationTimeLoader'
  private readonly parentAsyncCache: Cache<any>

  constructor(asyncCache: Cache<any>) {
    this.parentAsyncCache = asyncCache
  }

  get(key: string): Promise<number | undefined> {
    return this.parentAsyncCache.getExpirationTime(key)
  }
}
