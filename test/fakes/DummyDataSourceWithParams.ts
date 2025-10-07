import type { CacheKeyResolver } from '../../lib/AbstractCache'
import type { DataSource } from '../../lib/types/DataSources'

export type DummyLoaderParams = {
  prefix: string
  id: string
  suffix: string
}

export type DummyLoaderManyParams = {
  prefix: string
  suffix: string
}

export const DummyParamKeyResolver: CacheKeyResolver<DummyLoaderParams> = (params) => params.id

export class DummyDataSourceWithParams
  implements DataSource<string, DummyLoaderParams, DummyLoaderManyParams>
{
  value: string | undefined | null
  name = 'Dummy loader'
  isCache = false

  constructor(returnedValue: string | undefined) {
    this.value = returnedValue
  }

  get(params: DummyLoaderParams): Promise<string | undefined | null> {
    if (!params) {
      throw new Error('Params were not passed')
    }

    return Promise.resolve(`${params.prefix}${this.value}${params.suffix}`)
  }

  getMany(keys: string[], loadParams: DummyLoaderManyParams | undefined): Promise<string[]> {
    if (!loadParams) {
      throw new Error('Params were not passed')
    }

    return Promise.resolve(keys.map(() => this.value as string).filter((entry) => entry != null))
  }
}
