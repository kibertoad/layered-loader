import { Cache, CacheConfiguration } from '../../lib/DataSources'

export class CountingCache implements Cache<string> {
  private value: string | undefined
  public counter = 0
  name = 'Counting cache'
  isCache = true

  constructor(returnedValue: string | undefined) {
    this.value = returnedValue
  }

  get(): Promise<string | undefined | null> {
    this.counter++
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

  set(_key: string, value: string | null, _config: CacheConfiguration | undefined): Promise<void> {
    this.value = value ?? undefined
    return Promise.resolve(undefined)
  }
}
