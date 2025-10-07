import type { DataSource } from '../../lib/types/DataSources'

export class DelayedCountingLoader implements DataSource<string> {
  public value: string | undefined
  public counter = 0
  name = 'Counting loader'
  private resolver: (value: string) => void
  private promise: Promise<string>

  constructor(returnedValue: string | undefined) {
    this.value = returnedValue
  }

  get(): Promise<string | undefined | null> {
    this.counter++
    this.promise = new Promise<string>((resolve) => {
      this.resolver = resolve
    })
    return this.promise
  }

  getMany(): Promise<string[]> {
    throw new Error('Method not implemented.')
  }

  finishLoading() {
    this.resolver(this.value)
    return this.promise
  }
}
