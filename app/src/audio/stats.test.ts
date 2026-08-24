import { describe, expect, it } from 'vitest'
import { iqr, median, quantile } from './stats'

describe('stats', () => {
  it('median of odd-length samples', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([10, 20, 30, 40, 50])).toBe(30)
  })

  it('median of even-length samples averages the middle two', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  it('median of empty sample is null', () => {
    expect(median([])).toBeNull()
  })

  it('quantile interpolates (type 7)', () => {
    // For [1..4], q1 (p=.25) = 1.75, q3 (p=.75) = 3.25
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 6)
    expect(quantile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25, 6)
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 6)
  })

  it('iqr is q3 minus q1', () => {
    expect(iqr([1, 2, 3, 4])).toBeCloseTo(1.5, 6)
    expect(iqr([])).toBeNull()
  })
})
