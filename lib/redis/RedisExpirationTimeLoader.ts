import type { Cache, Loader } from '../types/DataSources'

export class RedisExpirationTimeLoader implements Loader<number> {
  public readonly name = 'RedisExpirationTimeLoader'
  private readonly parentAsyncCache: Cache<any>

  constructor(asyncCache: Cache<any>) {
    this.parentAsyncCache = asyncCache
  }

  get(key: string): Promise<number | undefined> {
    return this.parentAsyncCache.getExpirationTime(key)
  }
}
