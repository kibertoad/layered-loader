import type { Cache, DataSource } from '../types/DataSources'

export class RedisExpirationTimeDataSource implements DataSource<number, string> {
  public readonly name = 'RedisExpirationTimeLoader'
  private readonly parentAsyncCache: Cache<any>

  constructor(asyncCache: Cache<any>) {
    this.parentAsyncCache = asyncCache
  }

  get(key: string): Promise<number | undefined> {
    return this.parentAsyncCache.getExpirationTime(key)
  }

  /* c8 ignore next 3 */
  getMany(): Promise<number[]> {
    throw new Error('Not supported')
  }
}
