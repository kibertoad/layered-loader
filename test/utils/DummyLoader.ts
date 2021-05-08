import { Loader } from '../../lib/Loader'

export class DummyLoader implements Loader<string> {
  private readonly value: string | undefined
  isCache = false

  constructor(returnedValue: string | undefined) {
    this.value = returnedValue
  }

  get(): Promise<string | undefined | null> {
    return Promise.resolve(this.value)
  }
}
