import { describe, expect, it } from 'vitest'
import {
  A4_HZ,
  GUITAR_OPEN_STRINGS,
  centsBetween,
  freqToNearestNote,
  midiToFreq,
  midiToNoteName,
  nearestString,
} from './notes'

describe('notes', () => {
  it('A4 is 440 Hz at MIDI 69', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6)
  })

  it('maps low E (82.41 Hz) to E2 within a cent', () => {
    const { midi, note, cents } = freqToNearestNote(82.4069)
    expect(midi).toBe(40)
    expect(note).toBe('E2')
    expect(Math.abs(cents)).toBeLessThan(1)
  })

  it('names notes with scientific pitch notation', () => {
    expect(midiToNoteName(40)).toBe('E2')
    expect(midiToNoteName(45)).toBe('A2')
    expect(midiToNoteName(64)).toBe('E4')
    expect(midiToNoteName(69)).toBe('A4')
    expect(midiToNoteName(60)).toBe('C4')
  })

  it('computes cents between frequencies', () => {
    expect(centsBetween(440, 440)).toBe(0)
    expect(centsBetween(466.1638, 440)).toBeCloseTo(100, 1) // one semitone up
    expect(centsBetween(415.3047, 440)).toBeCloseTo(-100, 1) // one semitone down
  })

  it('has six open strings from E2 to E4', () => {
    expect(GUITAR_OPEN_STRINGS.map((s) => s.note)).toEqual(['E2', 'A2', 'D3', 'G3', 'B3', 'E4'])
    expect(GUITAR_OPEN_STRINGS[0].freq).toBeCloseTo(82.4069, 3)
    expect(GUITAR_OPEN_STRINGS[5].freq).toBeCloseTo(329.6276, 3)
  })

  it('finds the nearest string for a detuned frequency', () => {
    // A bit sharp of G3 should still report G3 (±250 cents window).
    const s = nearestString(200) // ~+17 cents sharp of G3
    expect(s?.note).toBe('G3')
    // Far from any open string.
    expect(nearestString(1500)).toBeNull()
  })

  it('A4_HZ constant is 440', () => {
    expect(A4_HZ).toBe(440)
  })
})
