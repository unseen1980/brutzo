/**
 * Pure analysis helpers over raw sample data. No Web Audio dependencies —
 * this makes them directly unit-testable and usable from both the live path
 * and the reference-clip harness (CLAUDE.md verification rule).
 */

export interface TimeDomainStats {
  /** Root-mean-square of the block (0..1 linear). */
  rms: number
  /** Absolute peak of the block (0..1). */
  peak: number
  /** True when flat-topped peaks were seen (≥3 consecutive samples at |x| ≥ 0.98). */
  clipped: boolean
  /** Longest run of clipped samples. */
  clipRun: number
}

export function analyzeTimeDomain(
  samples: Float32Array,
  start = 0,
  length = samples.length - start,
): TimeDomainStats {
  let sumSq = 0
  let peak = 0
  let clipRun = 0
  let maxRun = 0
  const end = start + length
  for (let i = start; i < end; i++) {
    const x = samples[i]
    if (Number.isFinite(x)) sumSq += x * x
    const a = Math.abs(x)
    if (a > peak) peak = a
    // Flat-topped peak: consecutive samples pinned at the rail.
    if (a >= 0.98) {
      clipRun++
      if (clipRun > maxRun) maxRun = clipRun
    } else {
      clipRun = 0
    }
  }
  const rms = Math.sqrt(sumSq / Math.max(1, length))
  return { rms, peak, clipped: maxRun >= 3, clipRun: maxRun }
}

/** RMS (linear) → dBFS. Scales tiny values to avoid -Infinity. */
export function rmsToDb(rms: number): number {
  return 20 * Math.log10(Math.max(rms, 1e-9))
}

export interface HumResult {
  /** Mains base frequency detected. */
  freqHz: 50 | 60
  /** Peak magnitude of the fundamental, dB (analyser scale). */
  fundamentalDb: number
  /** Fundamental rise above the local noise floor, dB. */
  excessDb: number
}

const GUARDED = new Set([50, 100, 150, 200, 60, 120, 180, 240])

/**
 * Detects mains hum (50 Hz EU / 60 Hz US + harmonics) from a magnitude
 * spectrum in dB, as produced by AnalyserNode.getFloatFrequencyData.
 *
 * Hum signature: a strong narrow fundamental at 50 or 60 Hz whose 2nd/3rd/4th
 * harmonics are also elevated above the local noise floor. Requiring the
 * harmonic pattern keeps low guitar notes (e.g. a 110 Hz A2 with overtones)
 * from tripping the detector.
 *
 * Resolution requirement: bins must be ≤ ~3 Hz (fftSize ≥ 16384 at 48 kHz) so
 * 50 Hz and 60 Hz land in disjoint bin groups. AudioGraph feeds this from a
 * 32768-point analyser.
 */
export function detectHum(
  spectrumDb: Float32Array,
  sampleRate: number,
  fftSize: number,
): HumResult | null {
  const binHz = sampleRate / fftSize
  if (spectrumDb.length < 32) return null

  const peakAt = (hz: number): number => {
    const center = hz / binHz
    const lo = Math.max(1, Math.floor(center) - 2)
    const hi = Math.min(spectrumDb.length - 1, Math.ceil(center) + 2)
    let m = -Infinity
    for (let b = lo; b <= hi; b++) {
      const v = spectrumDb[b]
      if (Number.isFinite(v) && v > m) m = v
    }
    return Number.isFinite(m) ? m : -200
  }

  // Local noise floor: median magnitude over the low band, excluding bins
  // near any hum candidate frequency.
  const lowBins: number[] = []
  const maxLowBin = Math.min(spectrumDb.length - 1, Math.ceil(400 / binHz))
  for (let b = 2; b <= maxLowBin; b++) {
    const hz = b * binHz
    let guarded = false
    for (const g of GUARDED) {
      if (Math.abs(hz - g) <= 2.5 * binHz) guarded = true
    }
    const v = spectrumDb[b]
    if (!guarded && Number.isFinite(v)) lowBins.push(v)
  }
  if (lowBins.length === 0) return null
  lowBins.sort((a, b) => a - b)
  const floor = lowBins[Math.floor(lowBins.length / 2)]

  let best: HumResult | null = null
  let bestScore = 0
  for (const base of [50, 60] as const) {
    const fundamentalDb = peakAt(base)
    const excess = fundamentalDb - floor
    const harmonics = [2 * base, 3 * base, 4 * base].map((h) => peakAt(h) - floor)
    const strongHarmonics = harmonics.filter((e) => e > 8).length
    const score = excess + harmonics.reduce((s, e) => s + Math.max(0, e), 0)
    // Fundamental ≥ 12 dB above the floor AND at least two elevated harmonics.
    if (excess >= 12 && strongHarmonics >= 2 && score > bestScore) {
      bestScore = score
      best = { freqHz: base, fundamentalDb, excessDb: excess }
    }
  }
  return best
}
