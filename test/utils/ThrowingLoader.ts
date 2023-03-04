import { Loader } from '../../lib/DataSources'

export class ThrowingLoader implements Loader<string> {
  name = 'Throwing loader'
  isCache = false

  async get(): Promise<string | undefined | null> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }
}
