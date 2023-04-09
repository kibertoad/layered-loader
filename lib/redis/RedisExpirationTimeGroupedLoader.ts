import type { GroupedCache, GroupLoader } from '../types/DataSources'

export class RedisExpirationTimeGroupedLoader implements GroupLoader<number> {
  public readonly name = 'RedisExpirationTimeGroupedLoader'
  private readonly parentAsyncCache: GroupedCache<any>

  constructor(asyncCache: GroupedCache<any>) {
    this.parentAsyncCache = asyncCache
  }

  getFromGroup(key: string, group: string): Promise<number | undefined> {
    return this.parentAsyncCache.getExpirationTimeFromGroup(key, group)
  }
}
