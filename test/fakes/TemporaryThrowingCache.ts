import type { Cache } from '../../lib/types/DataSources'

export class TemporaryThrowingCache implements Cache<string> {
  name = 'Throwing loader'
  isThrowing = true
  returnedValue = ''

  constructor(value: string) {
    this.returnedValue = value
  }

  async set() {}
  async clear() {}
  async delete() {}

  async get(): Promise<string | undefined | null> {
    if (this.isThrowing) {
      return Promise.resolve().then(() => {
        throw new Error('Error has occurred')
      })
    }
    return this.returnedValue
  }

  getExpirationTime(): Promise<number> {
    return Promise.resolve(99999)
  }
}
