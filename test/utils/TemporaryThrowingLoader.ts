import { Loader } from '../../lib/DataSources'

export class TemporaryThrowingLoader implements Loader<string> {
  name = 'Throwing loader'
  isCache = false
  isThrowing = true
  returnedValue = ''

  constructor(value: string) {
    this.returnedValue = value
  }

  async get(): Promise<string | undefined | null> {
    if (this.isThrowing) {
      throw new Error('Error has occurred')
    }
    return this.returnedValue
  }
}
