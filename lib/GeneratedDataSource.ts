import type { DataSource } from './types/DataSources'

export type GeneratedDataSourceParams<LoadedValue, LoaderParams = undefined, LoaderManyParams = LoaderParams> = {
  name?: string
  dataSourceGetOneFn?: (loadParams: LoaderParams) => Promise<LoadedValue | undefined | null>
  dataSourceGetManyFn?: (keys: string[], loadParams?: LoaderManyParams) => Promise<LoadedValue[]>
}

export class GeneratedDataSource<LoadedValue, LoadParams = undefined, LoadManyParams = LoadParams extends string ? undefined : LoadParams> implements DataSource<LoadedValue, LoadParams, LoadManyParams> {
  private readonly getOneFn: (loadParams: LoadParams) => Promise<LoadedValue | undefined | null>
  private readonly getManyFn: (keys: string[], loadParams?: LoadManyParams) => Promise<LoadedValue[]>
  public readonly name: string
  constructor(params: GeneratedDataSourceParams<LoadedValue, LoadParams, LoadManyParams>) {
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

  getMany(keys: string[], loadParams: LoadManyParams | undefined): Promise<LoadedValue[]> {
    return this.getManyFn(keys, loadParams)
  }
}
