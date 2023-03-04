import { AbstractOperation, CommonOperationConfig } from './AbstractOperation'
import { Loader } from './types/DataSources'

export type LoadingOperationConfig<T> = {
  loaders?: readonly Loader<T>[]
} & CommonOperationConfig<T>

export class LoadingOperation<LoadedValue> extends AbstractOperation<LoadedValue> {
  private readonly loaders: readonly Loader<LoadedValue>[]

  constructor(config: LoadingOperationConfig<LoadedValue>) {
    super(config)
    this.loaders = config.loaders ?? []
  }

  protected override async resolveValue(key: string): Promise<LoadedValue | undefined | null> {
    const cachedValue = await super.resolveValue(key)
    if (cachedValue !== undefined) {
      return cachedValue
    }

    for (let index = 0; index < this.loaders.length; index++) {
      const resolvedValue = await this.loaders[index].get(key).catch((err) => {
        this.loadErrorHandler(err, key, this.loaders[index], this.logger)
        if (this.throwIfLoadError) {
          throw err
        }
      })
      if (resolvedValue !== undefined) {
        if (this.asyncCache) {
          await this.asyncCache.set(key, resolvedValue).catch((err) => {
            this.cacheUpdateErrorHandler(err, key, this.asyncCache!, this.logger)
          })
        }
        return resolvedValue
      }
    }
    return undefined
  }
}
