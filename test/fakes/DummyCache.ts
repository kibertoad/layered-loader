import { Cache } from '../../lib/types/DataSources'

export class DummyCache implements Cache<string> {
  value: string | undefined | null
  name = 'Dummy cache'
  isCache = true

  constructor(returnedValue: string | undefined) {
    this.value = returnedValue
  }

  get(_key: string): Promise<string | undefined | null> {
    return Promise.resolve(this.value)
  }

  clear(): Promise<void> {
    this.value = undefined
    return Promise.resolve(undefined)
  }

  delete(_key: string): Promise<void> {
    this.value = undefined
    return Promise.resolve(undefined)
  }

  set(_key: string, value: string | null): Promise<void> {
    this.value = value ?? undefined
    return Promise.resolve(undefined)
  }
}
