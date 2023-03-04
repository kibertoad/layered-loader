import { AbstractOperation } from './AbstractOperation'

export class CachingOperation<LoadedValue> extends AbstractOperation<LoadedValue> {
  public async set(key: string, newValue: LoadedValue): Promise<void> {
    this.inMemoryCache.set(key, newValue)
    this.runningLoads.delete(key)
    if (this.asyncCache) {
      await this.asyncCache.set(key, newValue).catch((err) => {
        this.cacheUpdateErrorHandler(err, key, this.asyncCache!, this.logger)
      })
    }
  }
}
