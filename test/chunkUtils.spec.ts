import { chunk } from '../lib/utils/chunkUtils'

describe('chunkUtils', () => {
  it('null', () => {
    const value = chunk(null as any, 100)
    expect(value).toEqual([])
  })

  it('empty', () => {
    const value = chunk([], 100)
    expect(value).toEqual([])
  })

  it('multiple chunks', () => {
    const value = chunk([1, 2, 3, 4], 3)
    expect(value).toEqual([[1, 2, 3], [4]])
  })
})
