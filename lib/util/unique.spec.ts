import { describe, expect, it } from 'vitest'
import { unique } from './unique'

describe('unique', () => {
  it('returns the same array reference when there are no duplicates', () => {
    const input = [1, 2, 3, 'a', 'b']
    const result = unique(input)
    expect(result).toBe(input)
  })

  it('returns a new array when there are duplicates', () => {
    const input = [1, 2, 2, 3]
    const result = unique(input)
    expect(result).not.toBe(input)
    expect(result).toEqual([1, 2, 3])
  })

  it('returns a new array of mixed primitive value without duplicates', () => {
    const objectA = {}
    const objectB = {}
    const duplicateValues = [
      1,
      1,
      'a',
      'a',
      Number.NaN,
      Number.NaN,
      true,
      true,
      false,
      false,
      null,
      null,
      undefined,
      undefined,
      objectA,
      objectA,
      objectB,
      objectB,
    ]

    expect(unique(duplicateValues)).toEqual([
      1,
      'a',
      Number.NaN,
      true,
      false,
      null,
      undefined,
      objectA,
      objectB,
    ])
  })
})
