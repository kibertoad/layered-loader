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
  private readonly runningLoads: Map<string, Promise<LoadedValue | undefined | null> | undefined>

  constructor(loaders: readonly Loader<LoadedValue>[], params: LoadOperationConfig = DEFAULT_CONFIG) {
    this.params = params
    this.loaders = loaders
    this.runningLoads = new Map()

    this.cacheIndexes = loaders.reduce((result, value, index) => {
      if (value.isCache) {
        result.push(index)
      }
      return result
    }, [] as number[])
  }

  private async resolveValue(key: string): Promise<LoadedValue | undefined | null> {
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
            // ToDo add catch block
          })

        return resolvedValue
      }
    }
    return undefined
  }

  async load(key: string): Promise<LoadedValue | undefined | null> {
    const existingLoad = this.runningLoads.get(key)
    if (existingLoad) {
      return existingLoad
    }

    const loadingPromise = new Promise<LoadedValue | undefined | null>((resolve, reject) => {
      this.resolveValue(key).then((resolvedValue) => {
        this.runningLoads.set(key, undefined)

        if (resolvedValue === undefined && this.params.throwIfUnresolved) {
          return reject(new Error(`Failed to resolve value for key "${key}"`))
        }
        return resolve(resolvedValue)
      })
    })

    this.runningLoads.set(key, loadingPromise)
    return loadingPromise
  }
}
