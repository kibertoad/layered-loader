import type { DataSource } from '../../lib/types/DataSources'

export class ThrowingLoader implements DataSource<string> {
  name = 'Throwing loader'

  async get(): Promise<string | undefined | null> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  getMany(): Promise<string[]> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }
}
