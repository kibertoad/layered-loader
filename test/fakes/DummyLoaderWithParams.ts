import type { Loader } from '../../lib/types/DataSources'

export type DummyLoaderParams = {
  prefix: string
  suffix: string
}

export class DummyLoaderWithParams implements Loader<string, DummyLoaderParams> {
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
}
