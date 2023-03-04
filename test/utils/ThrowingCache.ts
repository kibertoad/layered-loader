import { Cache } from '../../lib/DataSources'

export class ThrowingCache implements Cache<string> {
  name = 'Throwing cache'
  isCache = true

  get(): Promise<string | undefined | null> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  clear(): Promise<void> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  delete(): Promise<void> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }

  set(): Promise<void> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }
}
