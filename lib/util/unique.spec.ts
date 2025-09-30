import { describe, expect, it } from 'vitest'
import { unique } from './unique'

describe('unique', () => {
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
