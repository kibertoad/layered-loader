import { GroupedCache, GroupLoader } from './types/DataSources'
import { LoadingOperationConfig } from './LoadingOperation'
import { AbstractGroupedOperation } from './AbstractGroupedOperation'

export type GroupedLoadingOperationConfig<LoadedValue> = LoadingOperationConfig<
  LoadedValue,
  GroupedCache<LoadedValue>,
  GroupLoader<LoadedValue>
>
export class GroupedLoadingOperation<LoadedValue> extends AbstractGroupedOperation<LoadedValue> {
  private readonly loaders: readonly GroupLoader<LoadedValue>[]
  protected readonly throwIfLoadError: boolean

  constructor(config: GroupedLoadingOperationConfig<LoadedValue>) {
    super(config)
    this.loaders = config.loaders ?? []
    this.throwIfLoadError = config.throwIfLoadError ?? true
  }

  protected override async resolveGroupValue(key: string, group: string): Promise<LoadedValue | undefined | null> {
    const cachedValue = await super.resolveGroupValue(key, group)
    if (cachedValue !== undefined) {
      return cachedValue
    }

    for (let index = 0; index < this.loaders.length; index++) {
      const resolvedValue = await this.loaders[index].getFromGroup(key, group).catch((err) => {
        this.loadErrorHandler(err, key, this.loaders[index], this.logger)
        if (this.throwIfLoadError) {
          throw err
        }
      })
      if (resolvedValue !== undefined || index === this.loaders.length - 1) {
        const finalValue = resolvedValue ?? null
        if (this.asyncCache) {
          await this.asyncCache.set(key, finalValue).catch((err) => {
            this.cacheUpdateErrorHandler(err, key, this.asyncCache!, this.logger)
          })
        }
        return finalValue
      }
    }
    return undefined
  }
}
