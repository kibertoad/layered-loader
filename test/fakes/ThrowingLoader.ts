import { Loader } from '../../lib/types/DataSources'

export class ThrowingLoader implements Loader<string> {
  name = 'Throwing loader'

  async get(): Promise<string | undefined | null> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }
}
