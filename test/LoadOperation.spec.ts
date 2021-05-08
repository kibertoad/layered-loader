import { LoadOperation } from '../lib/LoadOperation'

describe('LoadOperation', () => {
  describe('load', () => {
    it('loads value with single loader successfully', async () => {
      const operation = new LoadOperation()
      const result = await operation.load()
      expect(result).toBe(undefined)
    })
  })
})
