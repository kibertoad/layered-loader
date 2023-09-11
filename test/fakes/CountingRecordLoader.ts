import type { DataSource } from '../../lib/types/DataSources'

export class CountingRecordLoader implements DataSource<string> {
  public values: Record<string, string>
  public counter = 0
  name = 'Counting loader'
  isCache = false

  constructor(returnedValues: Record<string, string>) {
    this.values = returnedValues
  }

  get(key: string): Promise<string | undefined | null> {
    this.counter++

    return Promise.resolve(this.values[key])
  }

  getMany(keys: string[]): Promise<string[]> {
    this.counter++

    const foundValues: string[] = Object.entries(this.values)
      .filter(([key, value]) => {
        return value && keys.includes(key)
      })
      .map((entry) => entry[1])

    return Promise.resolve(foundValues)
  }
}
