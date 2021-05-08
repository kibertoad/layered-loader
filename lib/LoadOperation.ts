import { Loader, Cache } from './Loader'

export type LoadOperationConfig = {
  throwIfUnresolved?: boolean
}

const DEFAULT_CONFIG: LoadOperationConfig = {
  throwIfUnresolved: false,
}

export class LoadOperation<LoadedValue> {
  private readonly params: LoadOperationConfig
  private readonly loaders: readonly Loader<LoadedValue>[]
  private readonly cacheIndexes: readonly number[]

  constructor(loaders: readonly Loader<LoadedValue>[], params: LoadOperationConfig = DEFAULT_CONFIG) {
    this.params = params
    this.loaders = loaders

    this.cacheIndexes = loaders.reduce((result, value, index) => {
      if (value.isCache) {
        result.push(index)
      }
      return result
    }, [] as number[])
  }

  async load(key: string): Promise<LoadedValue | undefined | null> {
    for (let index = 0; index < this.loaders.length; index++) {
      const resolvedValue = await this.loaders[index].get(key)
      if (resolvedValue) {
        // update caches
        this.cacheIndexes
          .filter((cacheIndex) => {
            return cacheIndex < index
          })
          .forEach((cacheIndex) => {
            ;((this.loaders[cacheIndex] as unknown) as Cache<LoadedValue>).set(key, resolvedValue)
          })

        return resolvedValue
      }
    }

    if (this.params.throwIfUnresolved) {
      throw new Error(`Failed to resolve value for key "${key}"`)
    }

    return undefined
  }
}
