import { describe, expect, it } from 'vitest'
import { pairOnsetsToClicks } from './timing'

describe('pairOnsetsToClicks', () => {
  const halfBeat = 60 / 80 / 2 // 0.375 s at 80 BPM

  /** Element-wise close comparison (float seconds → ms amplifies ULP noise). */
  function expectOffsets(actual: number[], expected: number[]): void {
    expect(actual.length).toBe(expected.length)
    expected.forEach((e, i) => expect(actual[i]).toBeCloseTo(e, 6))
  }

  it('pairs on-time strums at the right offsets', () => {
    const clicks = [1.0, 1.75, 2.5, 3.25]
    const onsets = [1.01, 1.76, 2.49, 3.26]
    expectOffsets(pairOnsetsToClicks(onsets, clicks, halfBeat), [10, 10, -10, 10])
  })

  it('skips clicks whose strum was missed without shifting the others', () => {
    // User missed the 2nd click entirely; naive index pairing would shift
    // every later offset by a full beat (750 ms) and destroy the median.
    const clicks = [1.0, 1.75, 2.5, 3.25]
    const onsets = [1.0, 2.51, 3.24] // strum 2 missing
    expectOffsets(pairOnsetsToClicks(onsets, clicks, halfBeat), [0, 10, -10])
  })

  it('ignores double triggers (extra onset near a click)', () => {
    const clicks = [1.0, 1.75]
    const onsets = [1.0, 1.04, 1.76] // spurious retrigger after the first strum
    expectOffsets(pairOnsetsToClicks(onsets, clicks, halfBeat), [0, 10])
  })

  it('ignores onsets before the first click (pre-roll noise)', () => {
    const clicks = [1.0, 1.75]
    const onsets = [0.4, 1.02, 1.74]
    expectOffsets(pairOnsetsToClicks(onsets, clicks, halfBeat), [20, -10])
  })

  it('ignores onsets more than half a beat from any click', () => {
    const clicks = [1.0, 1.75]
    const onsets = [1.0, 2.4] // 0.65 s after click 2 — beyond half a beat
    expectOffsets(pairOnsetsToClicks(onsets, clicks, halfBeat), [0])
  })

  it('returns empty for silence', () => {
    expect(pairOnsetsToClicks([], [1.0, 1.75], halfBeat)).toEqual([])
  })
})
