import type { DataSource } from '../../lib/types/DataSources'

export class DummyLoader implements DataSource<string> {
  value: string | undefined | null
  name = 'Dummy loader'
  isCache = false

  constructor(returnedValue: string | undefined) {
    this.value = returnedValue
  }

  get(): Promise<string | undefined | null> {
    return Promise.resolve(this.value)
  }

  getMany(keys: string[]) {
    return Promise.resolve(keys.map(() => this.value as string).filter((entry) => entry != null))
  }
}
