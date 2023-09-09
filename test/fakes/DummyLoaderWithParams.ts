import type { DataSource } from '../../lib/types/DataSources'

export type DummyLoaderParams = {
  prefix: string
  suffix: string
}

export class DummyLoaderWithParams implements DataSource<string, DummyLoaderParams> {
  value: string | undefined | null
  name = 'Dummy loader'
  isCache = false

  constructor(returnedValue: string | undefined) {
    this.value = returnedValue
  }

  get(_key: string, params?: DummyLoaderParams): Promise<string | undefined | null> {
    if (!params) {
      throw new Error('Params were not passed')
    }

    return Promise.resolve(`${params.prefix}${this.value}${params.suffix}`)
  }

  getMany(keys: string[], loadParams: DummyLoaderParams | undefined): Promise<string[]> {
    if (!loadParams) {
      throw new Error('Params were not passed')
    }

    return Promise.resolve(keys.map(() => this.value as string).filter((entry) => entry != null))
  }
}
