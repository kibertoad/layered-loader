import { Loader } from '../../lib/DataSources'

export class DummyLoader implements Loader<string> {
  value: string | undefined | null
  name = 'Dummy loader'
  isCache = false

  constructor(returnedValue: string | undefined) {
    this.value = returnedValue
  }

  get(): Promise<string | undefined | null> {
    return Promise.resolve(this.value)
  }
}
