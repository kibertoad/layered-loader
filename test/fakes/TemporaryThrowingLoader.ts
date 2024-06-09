import type { DataSource } from '../../lib/types/DataSources'

export class TemporaryThrowingLoader implements DataSource<string> {
  name = 'Throwing loader'
  isCache = false
  isThrowing = true
  returnedValue = ''

  constructor(value: string) {
    this.returnedValue = value
  }

  async get(): Promise<string | undefined | null> {
    if (this.isThrowing) {
      return Promise.resolve().then(() => {
        throw new Error('Error has occurred')
      })
    }
    return this.returnedValue
  }

  getMany(keys: string[], _loadParams: undefined): Promise<string[]> {
    if (this.isThrowing) {
      return Promise.resolve().then(() => {
        throw new Error('Error has occurred')
      })
    }
    return Promise.resolve(
      keys.map(() => this.returnedValue as string).filter((entry) => entry != null),
    )
  }
}
