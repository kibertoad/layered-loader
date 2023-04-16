import type { GroupDataSource } from '../../lib/types/DataSources'

export class ThrowingGroupedLoader implements GroupDataSource<string> {
  name = 'Throwing loader'

  async getFromGroup(): Promise<string | undefined | null> {
    return Promise.resolve().then(() => {
      throw new Error('Error has occurred')
    })
  }
}
