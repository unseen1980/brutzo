import { describe, expect, it } from 'vitest'
import { analyzeTimeDomain, detectHum, rmsToDb } from './detection'

describe('analyzeTimeDomain', () => {
  it('computes RMS and peak of a sine', () => {
    const sr = 44100
    const buf = new Float32Array(sr)
    for (let i = 0; i < buf.length; i++) buf[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr)
    const stats = analyzeTimeDomain(buf)
    expect(stats.rms).toBeCloseTo(0.5 / Math.SQRT2, 2)
    expect(stats.peak).toBeCloseTo(0.5, 2)
    expect(stats.clipped).toBe(false)
  })

  it('detects flat-topped clipping', () => {
    const sr = 44100
    const buf = new Float32Array(sr)
    // A hot sine clamped at the rail: flat-topped peaks for many samples.
    for (let i = 0; i < buf.length; i++) {
      const x = 1.2 * Math.sin((2 * Math.PI * 110 * i) / sr)
      buf[i] = Math.max(-0.99, Math.min(0.99, x))
    }
    const stats = analyzeTimeDomain(buf)
    expect(stats.clipped).toBe(true)
    expect(stats.clipRun).toBeGreaterThanOrEqual(3)
  })

  it('does not call quiet signal clipped', () => {
    const buf = new Float32Array(4096).fill(0.01)
    const stats = analyzeTimeDomain(buf)
    expect(stats.clipped).toBe(false)
    expect(stats.rms).toBeCloseTo(0.01, 4)
  })

  it('supports slicing via start/length', () => {
    const buf = new Float32Array(1000)
    buf.fill(0.1, 0, 500)
    buf.fill(0.5, 500)
    const secondHalf = analyzeTimeDomain(buf, 500, 500)
    expect(secondHalf.rms).toBeCloseTo(0.5, 4)
  })
})

describe('rmsToDb', () => {
  it('converts linear RMS to dBFS', () => {
    expect(rmsToDb(1)).toBeCloseTo(0, 4)
    expect(rmsToDb(0.1)).toBeCloseTo(-20, 4)
    expect(rmsToDb(0.01)).toBeCloseTo(-40, 4)
  })
})

describe('detectHum', () => {
  // 32768-point FFT at 48 kHz → 1.46 Hz bins: 50 Hz and 60 Hz are separable.
  // AudioGraph uses this exact configuration for its spectrum analyser.
  const SR = 48000
  const FFT = 32768
  const BIN_HZ = SR / FFT

  function spectrum(): Float32Array {
    return new Float32Array(FFT / 2).fill(-80)
  }

  function raise(sp: Float32Array, hz: number, db: number): void {
    const center = Math.round(hz / BIN_HZ)
    for (let b = center - 1; b <= center + 1; b++) {
      if (b >= 0 && b < sp.length) sp[b] = db
    }
  }

  it('detects 50 Hz mains hum with harmonics', () => {
    const sp = spectrum()
    raise(sp, 50, -35)
    raise(sp, 100, -40)
    raise(sp, 150, -45)
    const result = detectHum(sp, SR, FFT)
    expect(result).not.toBeNull()
    expect(result!.freqHz).toBe(50)
    expect(result!.excessDb).toBeGreaterThanOrEqual(12)
  })

  it('detects 60 Hz mains hum with harmonics', () => {
    const sp = spectrum()
    raise(sp, 60, -32)
    raise(sp, 120, -38)
    raise(sp, 180, -44)
    raise(sp, 240, -50)
    const result = detectHum(sp, SR, FFT)
    expect(result).not.toBeNull()
    expect(result!.freqHz).toBe(60)
  })

  it('does not fire on a clean floor', () => {
    expect(detectHum(spectrum(), SR, FFT)).toBeNull()
  })

  it('does not fire on a low guitar note with overtones (110/220/330 Hz)', () => {
    const sp = spectrum()
    raise(sp, 110, -30)
    raise(sp, 220, -35)
    raise(sp, 330, -40)
    raise(sp, 440, -45)
    expect(detectHum(sp, SR, FFT)).toBeNull()
  })

  it('requires the harmonic pattern — a lone 50 Hz bump is not hum', () => {
    const sp = spectrum()
    raise(sp, 50, -30)
    expect(detectHum(sp, SR, FFT)).toBeNull()
  })
})
