import { CommonOperationConfig } from './AbstractOperation'
import { Loader } from './types/DataSources'
import { AbstractFlatOperation } from './AbstractFlatOperation'

export type LoadingOperationConfig<LoadedValue> = {
  loaders?: readonly Loader<LoadedValue>[]
  throwIfLoadError?: boolean
} & CommonOperationConfig<LoadedValue>

export class LoadingOperation<LoadedValue> extends AbstractFlatOperation<LoadedValue> {
  private readonly loaders: readonly Loader<LoadedValue>[]
  protected readonly throwIfLoadError: boolean

  constructor(config: LoadingOperationConfig<LoadedValue>) {
    super(config)
    this.loaders = config.loaders ?? []
    this.throwIfLoadError = config.throwIfLoadError ?? true
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
