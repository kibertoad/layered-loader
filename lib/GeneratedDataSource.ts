import type { DataSource } from './types/DataSources'

export type GeneratedDataSourceParams<LoadedValue, LoaderParams = undefined> = {
  name?: string
  dataSourceGetOneFn?: (loadParams: LoaderParams) => Promise<LoadedValue | undefined | null>
  dataSourceGetManyFn?: (keys: string[], loadParams?: LoaderParams) => Promise<LoadedValue[]>
}

export class GeneratedDataSource<LoadedValue, LoadParams = undefined> implements DataSource<LoadedValue, LoadParams> {
  private readonly getOneFn: (loadParams: LoadParams) => Promise<LoadedValue | undefined | null>
  private readonly getManyFn: (keys: string[], loadParams?: LoadParams) => Promise<LoadedValue[]>
  public readonly name: string
  constructor(params: GeneratedDataSourceParams<LoadedValue, LoadParams>) {
    this.name = params.name ?? 'Generated loader'
    this.getOneFn =
      params.dataSourceGetOneFn ??
      (() => {
        throw new Error('Retrieval of a single entity is not implemented')
      })

    this.getManyFn =
      params.dataSourceGetManyFn ??
      (() => {
        throw new Error('Retrieval of multiple entities is not implemented')
      })
  }

  get(loadParams: LoadParams): Promise<LoadedValue | undefined | null> {
    return this.getOneFn(loadParams)
  }

  getMany(keys: string[], loadParams: LoadParams | undefined): Promise<LoadedValue[]> {
    return this.getManyFn(keys, loadParams)
  }
}
