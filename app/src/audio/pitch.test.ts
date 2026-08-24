import { describe, expect, it } from 'vitest'
import { YinPitchDetector } from './pitch'
import { centsBetween } from './notes'

/** Synthesizes a harmonic tone into a Float32Array. */
function tone(
  freq: number,
  seconds: number,
  sampleRate: number,
  harmonics: Array<[number, number]> = [[1, 1]],
  amplitude = 0.5,
): Float32Array {
  const n = Math.floor(seconds * sampleRate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    let v = 0
    for (const [mult, amp] of harmonics) v += amp * Math.sin(2 * Math.PI * freq * mult * t)
    out[i] = amplitude * v
  }
  return out
}

/** Deterministic pseudo-random noise (LCG) so tests are reproducible. */
function noise(seconds: number, sampleRate: number, amplitude = 0.2): Float32Array {
  const n = Math.floor(seconds * sampleRate)
  const out = new Float32Array(n)
  let state = 0x2f6e2b1
  for (let i = 0; i < n; i++) {
    state = (state * 1664525 + 1013904223) >>> 0
    out[i] = amplitude * ((state / 0xffffffff) * 2 - 1)
  }
  return out
}

describe('YinPitchDetector', () => {
  it('detects low E (82.41 Hz) at 44.1 kHz within 1 cent — the Phase 0 requirement', () => {
    const sampleRate = 44100
    const det = new YinPitchDetector(sampleRate)
    const buf = tone(82.4069, 1.0, sampleRate)
    // Analyze a window in the steady middle of the tone.
    const start = Math.floor(buf.length / 2) - Math.floor(det.requiredLength / 2)
    const result = det.detect(buf, start)
    expect(result).not.toBeNull()
    expect(Math.abs(centsBetween(result!.freq, 82.4069))).toBeLessThan(1)
    expect(result!.probability).toBeGreaterThan(0.8)
  })

  it('detects low E at 48 kHz within 1 cent (sample-rate independence)', () => {
    const sampleRate = 48000
    const det = new YinPitchDetector(sampleRate)
    const buf = tone(82.4069, 1.0, sampleRate)
    const start = Math.floor(buf.length / 2) - Math.floor(det.requiredLength / 2)
    const result = det.detect(buf, start)
    expect(result).not.toBeNull()
    expect(Math.abs(centsBetween(result!.freq, 82.4069))).toBeLessThan(1)
  })

  it.each([
    [110.0, 44100],
    [146.8324, 44100],
    [195.9977, 48000],
    [246.9417, 44100],
    [329.6276, 48000],
    [440.0, 44100],
    [880.0, 48000],
  ])('detects %f Hz at %i Hz sample rate within 1 cent', (freq, sampleRate) => {
    const det = new YinPitchDetector(sampleRate)
    const buf = tone(freq, 0.6, sampleRate)
    const start = Math.floor(buf.length / 2) - Math.floor(det.requiredLength / 2)
    const result = det.detect(buf, start)
    expect(result).not.toBeNull()
    expect(Math.abs(centsBetween(result!.freq, freq))).toBeLessThan(1)
  })

  it('does not octave-error on a guitar-like harmonic stack', () => {
    const sampleRate = 44100
    const det = new YinPitchDetector(sampleRate)
    // Fundamental + strong 2nd/3rd/4th harmonics, like a plucked string.
    const buf = tone(329.6276, 0.6, sampleRate, [
      [1, 1],
      [2, 0.6],
      [3, 0.35],
      [4, 0.2],
    ])
    const start = Math.floor(buf.length / 2) - Math.floor(det.requiredLength / 2)
    const result = det.detect(buf, start)
    expect(result).not.toBeNull()
    expect(Math.abs(centsBetween(result!.freq, 329.6276))).toBeLessThan(2)
  })

  it('returns null for digital silence', () => {
    const det = new YinPitchDetector(44100)
    expect(det.detect(new Float32Array(det.requiredLength + 100), 10)).toBeNull()
  })

  it('returns null or low confidence for broadband noise', () => {
    const det = new YinPitchDetector(44100)
    const buf = noise(1.0, 44100)
    const start = Math.floor(buf.length / 2)
    const result = det.detect(buf, start)
    if (result !== null) {
      expect(result.probability).toBeLessThan(0.6)
    }
  })

  it('reports the RMS of the analyzed window', () => {
    const det = new YinPitchDetector(44100)
    const buf = tone(220, 1.0, 44100, [[1, 1]], 0.5)
    const start = Math.floor(buf.length / 2)
    const result = det.detect(buf, start)
    expect(result).not.toBeNull()
    expect(result!.rms).toBeGreaterThan(0.3)
    expect(result!.rms).toBeLessThan(0.4)
  })

  it('refuses windows that fall off the end of the buffer', () => {
    const det = new YinPitchDetector(44100)
    const short = new Float32Array(100)
    expect(det.detect(short, 0)).toBeNull()
    expect(det.detect(short, -1)).toBeNull()
  })
})
