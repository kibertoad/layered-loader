import { Cache } from '../../lib/DataSources'

export class ThrowingCache implements Cache<string> {
  name = 'Throwing cache'
  isCache = true

  get(): Promise<string | undefined | null> {
    throw new Error('Error has occurred')
  }

  clear(): Promise<void> {
    throw new Error('Error has occurred')
  }

  delete(): Promise<void> {
    throw new Error('Error has occurred')
  }

  set(): Promise<void> {
    throw new Error('Error has occurred')
  }
}
