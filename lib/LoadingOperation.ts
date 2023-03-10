import { CommonOperationConfig } from './AbstractOperation'
import { Cache, Loader } from './types/DataSources'
import { AbstractFlatOperation } from './AbstractFlatOperation'

export type LoadingOperationConfig<
  LoadedValue,
  CacheType extends Cache<LoadedValue> = Cache<LoadedValue>,
  LoaderParams = undefined,
  LoaderType = Loader<LoadedValue, LoaderParams>
> = {
  loaders?: readonly LoaderType[]
  throwIfLoadError?: boolean
  throwIfUnresolved?: boolean
} & CommonOperationConfig<LoadedValue, CacheType>

export class LoadingOperation<LoadedValue, LoaderParams = undefined> extends AbstractFlatOperation<
  LoadedValue,
  LoaderParams
> {
  private readonly loaders: readonly Loader<LoadedValue, LoaderParams>[]
  protected readonly throwIfLoadError: boolean
  protected readonly throwIfUnresolved: boolean

  constructor(config: LoadingOperationConfig<LoadedValue, Cache<LoadedValue>, LoaderParams>) {
    super(config)
    this.loaders = config.loaders ?? []
    this.throwIfLoadError = config.throwIfLoadError ?? true
    this.throwIfUnresolved = config.throwIfUnresolved ?? false
  }

  protected override async resolveValue(
    key: string,
    loadParams?: LoaderParams
  ): Promise<LoadedValue | undefined | null> {
    const cachedValue = await super.resolveValue(key, loadParams)
    if (cachedValue !== undefined) {
      return cachedValue
    }

    for (let index = 0; index < this.loaders.length; index++) {
      const resolvedValue = await this.loaders[index].get(key, loadParams).catch((err) => {
        this.loadErrorHandler(err, key, this.loaders[index], this.logger)
        if (this.throwIfLoadError) {
          throw err
        }
      })
      if (resolvedValue !== undefined || index === this.loaders.length - 1) {
        if (resolvedValue === undefined && this.throwIfUnresolved) {
          throw new Error(`Failed to resolve value for key "${key}"`)
        }

        const finalValue = resolvedValue ?? null
        if (this.asyncCache) {
          await this.asyncCache.set(key, finalValue).catch((err) => {
            this.cacheUpdateErrorHandler(err, key, this.asyncCache!, this.logger)
          })
        }
        return finalValue
      }
    }

    if (this.throwIfUnresolved) {
      throw new Error(`Failed to resolve value for key "${key}"`)
    }
    return undefined
  }
}
