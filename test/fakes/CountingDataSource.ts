import type { DataSource } from '../../lib/types/DataSources'

export class CountingDataSource implements DataSource<string> {
  public value: string | undefined | null
  public counter = 0
  name = 'Counting loader'
  isCache = false

  constructor(returnedValue: string | null) {
    this.value = returnedValue
  }

  get(): Promise<string | undefined | null> {
    this.counter++
    return Promise.resolve(this.value)
  }

  getMany(keys: string[], _loadManyParams: undefined): Promise<string[]> {
    this.counter++

    return Promise.resolve(keys.map(() => this.value as string).filter((entry) => entry != null))
  }
}
