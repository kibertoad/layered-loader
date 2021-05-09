import { Loader, Cache } from './Loader'

export type LoadOperationConfig = {
  throwIfUnresolved: boolean
  cacheUpdateErrorHandler: LoaderErrorHandler
  loadErrorHandler: LoaderErrorHandler
}

export type LoaderErrorHandler = (err: Error, key: string, loader: Loader<any>) => void

export const DEFAULT_LOAD_ERROR_HANDLER: LoaderErrorHandler = (err, key, loader) => {
  console.error(`Error while loading "${key}" with ${loader.name}: ${err.message}`)
}

export const DEFAULT_CACHE_ERROR_HANDLER: LoaderErrorHandler = (err, key, cache) => {
  console.error(`Error while caching "${key}" with ${cache.name}: ${err.message}`)
}

const DEFAULT_CONFIG: LoadOperationConfig = {
  throwIfUnresolved: false,
  cacheUpdateErrorHandler: DEFAULT_CACHE_ERROR_HANDLER,
  loadErrorHandler: DEFAULT_LOAD_ERROR_HANDLER,
}

export class LoadOperation<LoadedValue> {
  private readonly params: LoadOperationConfig
  private readonly loaders: readonly Loader<LoadedValue>[]
  private readonly cacheIndexes: readonly number[]
  private readonly runningLoads: Map<string, Promise<LoadedValue | undefined | null> | undefined>

  constructor(loaders: readonly Loader<LoadedValue>[], params: Partial<LoadOperationConfig> = DEFAULT_CONFIG) {
    this.params = {
      ...DEFAULT_CONFIG,
      ...params,
    }
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
      const resolvedValue = await Promise.resolve()
        .then(() => {
          return this.loaders[index].get(key)
        })
        .catch((err) => {
          this.params.loadErrorHandler(err, key, this.loaders[index])

          // if last loader, fail
          if (index === this.loaders.length - 1) {
            throw new Error(`Failed to resolve value for key "${key}": ${err.message}`)
          }
        })

      if (resolvedValue) {
        // update caches
        this.cacheIndexes
          .filter((cacheIndex) => {
            return cacheIndex < index
          })
          .forEach((cacheIndex) => {
            Promise.resolve()
              .then(() => {
                return ((this.loaders[cacheIndex] as unknown) as Cache<LoadedValue>).set(key, resolvedValue)
              })
              .catch((err) => {
                this.params.cacheUpdateErrorHandler(err, key, this.loaders[cacheIndex])
              })
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
      this.resolveValue(key)
        .then((resolvedValue) => {
          this.runningLoads.set(key, undefined)

          if (resolvedValue === undefined && this.params.throwIfUnresolved) {
            return reject(new Error(`Failed to resolve value for key "${key}"`))
          }
          return resolve(resolvedValue)
        })
        .catch(reject)
    })

    this.runningLoads.set(key, loadingPromise)
    return loadingPromise
  }
}
