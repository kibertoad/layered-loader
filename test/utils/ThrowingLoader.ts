import { Loader } from '../../lib/Loader'

export class ThrowingLoader implements Loader<string> {
  name = 'Throwing loader'
  isCache = false

  async get(): Promise<string | undefined | null> {
    throw new Error('Error has occurred')
  }
}
