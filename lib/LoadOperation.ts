export type LoadOperationConfig = {
  throwIfUnresolved?: boolean
}

export class LoadOperation<LoadedValue, LoadParams> {
  private readonly params: LoadOperationConfig

  constructor(params: LoadOperationConfig = {}) {
    this.params = params
  }

  async load(loadParams: LoadParams = {} as any): Promise<LoadedValue> {
    return undefined as any
  }
}
