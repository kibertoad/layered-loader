import { Loader } from '../../lib/Loader'

export class CountingLoader implements Loader<string> {
  private readonly value: string | undefined
  public counter = 0
  isCache = false

  constructor(returnedValue: string | undefined) {
    this.value = returnedValue
  }

  get(_key: string): Promise<string | undefined | null> {
    this.counter++
    return Promise.resolve(this.value)
  }
}
