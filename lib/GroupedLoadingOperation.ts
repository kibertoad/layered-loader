import { GroupedCache, GroupLoader } from './types/DataSources'
import { LoadingOperationConfig } from './LoadingOperation'
import { AbstractGroupedOperation } from './AbstractGroupedOperation'

export type GroupedLoadingOperationConfig<LoadedValue, LoaderParams = undefined> = LoadingOperationConfig<
  LoadedValue,
  GroupedCache<LoadedValue>,
  LoaderParams,
  GroupLoader<LoadedValue, LoaderParams>
>
export class GroupedLoadingOperation<LoadedValue, LoaderParams = undefined> extends AbstractGroupedOperation<
  LoadedValue,
  LoaderParams
> {
  private readonly loaders: readonly GroupLoader<LoadedValue, LoaderParams>[]
  protected readonly throwIfLoadError: boolean
  protected readonly throwIfUnresolved: boolean

  constructor(config: GroupedLoadingOperationConfig<LoadedValue, LoaderParams>) {
    super(config)
    this.loaders = config.loaders ?? []
    this.throwIfLoadError = config.throwIfLoadError ?? true
    this.throwIfUnresolved = config.throwIfUnresolved ?? false
  }

  protected override async resolveGroupValue(
    key: string,
    group: string,
    loadParams?: LoaderParams
  ): Promise<LoadedValue | undefined | null> {
    const cachedValue = await super.resolveGroupValue(key, group)
    if (cachedValue !== undefined) {
      if (this.asyncCache?.ttlLeftBeforeRefreshInMsecs) {
        const expirationTime = await this.asyncCache.getExpirationTimeFromGroup(key, group)
        if (expirationTime && expirationTime - Date.now() < this.asyncCache.ttlLeftBeforeRefreshInMsecs) {
          this.loadFromLoaders(key, group, loadParams).catch((err) => {
            this.logger.error(err.message)
          })
        }
      }

      return cachedValue
    }

    const finalValue = await this.loadFromLoaders(key, group, loadParams)
    if (finalValue !== undefined) {
      return finalValue
    }

    if (this.throwIfUnresolved) {
      throw new Error(`Failed to resolve value for key "${key}", group "${group}"`)
    }
    return undefined
  }

  private async loadFromLoaders(key: string, group: string, loadParams?: LoaderParams) {
    for (let index = 0; index < this.loaders.length; index++) {
      const resolvedValue = await this.loaders[index].getFromGroup(key, group, loadParams).catch((err) => {
        this.loadErrorHandler(err, key, this.loaders[index], this.logger)
        if (this.throwIfLoadError) {
          throw err
        }
      })
      if (resolvedValue !== undefined || index === this.loaders.length - 1) {
        if (resolvedValue === undefined && this.throwIfUnresolved) {
          throw new Error(`Failed to resolve value for key "${key}", group "${group}"`)
        }

        const finalValue = resolvedValue ?? null
        if (this.asyncCache) {
          await this.asyncCache.setForGroup(key, finalValue, group).catch((err) => {
            this.cacheUpdateErrorHandler(err, key, this.asyncCache!, this.logger)
          })
        }
        return finalValue
      }
    }

    return undefined
  }
}
