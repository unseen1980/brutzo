/**
 * YIN pitch detection (de Cheveigné & Kawahara, 2002) in plain TypeScript.
 *
 * Design notes:
 * - Must be reliable down to low E (82.41 Hz). We give the search headroom to
 *   70 Hz, which at 48 kHz means tau up to ~686 samples and a window of two
 *   periods (~1372 samples). Sample-rate assumptions are explicit: the class
 *   is constructed with the AudioContext's actual sampleRate (44.1k and 48k
 *   are both fine — nothing here assumes either).
 * - Used identically by the live path (slices of AnalyserNode time-domain
 *   data) and the reference-clip harness (slices of decoded WAV buffers).
 * - Buffers are preallocated once per detector; detect() allocates nothing
 *   beyond the small result object.
 */

export interface PitchResult {
  /** Estimated fundamental frequency in Hz. */
  freq: number
  /** Clarity 0..1 (1 − YIN normalized minimum). Callers gate on this. */
  probability: number
  /** RMS of the analyzed window (0..1). */
  rms: number
}

export interface YinOptions {
  /** YIN absolute threshold on the normalized difference (default 0.12). */
  threshold?: number
  /** Lowest frequency to search for (default 70 Hz — covers low E with margin). */
  minFreq?: number
  /** Highest frequency to search for (default 1000 Hz — above the guitar's range). */
  maxFreq?: number
}

export class YinPitchDetector {
  readonly threshold: number
  readonly tauMin: number
  readonly tauMax: number
  /** Difference-function window length in samples (~2 periods of minFreq). */
  readonly windowSize: number
  /** Total samples detect() needs from `start`: windowSize + tauMax. */
  readonly requiredLength: number

  private readonly sampleRate: number
  /** Holds d(tau), then the normalized d'(tau). Index 0 unused (d'(0) = 1). */
  private readonly diff: Float32Array

  constructor(sampleRate: number, opts: YinOptions = {}) {
    this.sampleRate = sampleRate
    this.threshold = opts.threshold ?? 0.12
    const minFreq = opts.minFreq ?? 70
    const maxFreq = opts.maxFreq ?? 1000
    this.tauMin = Math.max(2, Math.floor(sampleRate / maxFreq))
    this.tauMax = Math.ceil(sampleRate / minFreq)
    this.windowSize = 2 * this.tauMax
    this.requiredLength = this.windowSize + this.tauMax
    this.diff = new Float32Array(this.tauMax + 1)
  }

  /**
   * Runs YIN on samples[start .. start + requiredLength).
   * Returns null when no periodic fundamental is found (silence, noise).
   */
  detect(samples: Float32Array, start: number): PitchResult | null {
    const { windowSize: w, tauMin, tauMax, diff } = this
    if (start < 0 || start + this.requiredLength > samples.length) return null

    // --- RMS over the window (callers gate on it via result.rms) ---
    let sumSq = 0
    for (let i = 0; i < this.requiredLength; i++) {
      const x = samples[start + i]
      sumSq += x * x
    }
    const rms = Math.sqrt(sumSq / this.requiredLength)

    // --- Step 1: squared difference function d(tau), tau = 1..tauMax ---
    let total = 0
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0
      const base = start + tau
      for (let j = 0; j < w; j++) {
        const d = samples[start + j] - samples[base + j]
        sum += d * d
      }
      diff[tau] = sum
      total += sum
    }
    // Constant signal (DC / digital silence): zero differences, no pitch.
    if (total === 0) return null

    // --- Step 2: cumulative mean normalized difference d'(tau) ---
    // d'(tau) = d(tau) * tau / sum_{j=1..tau} d(j), d'(0) = 1.
    let running = 0
    for (let tau = 1; tau <= tauMax; tau++) {
      running += diff[tau]
      diff[tau] = (diff[tau] * tau) / running
    }

    // --- Step 3: first tau in range below threshold, then walk to the local minimum ---
    let tau = -1
    for (let t = tauMin; t <= tauMax; t++) {
      if (diff[t] < this.threshold) {
        while (t + 1 <= tauMax && diff[t + 1] < diff[t]) t++
        tau = t
        break
      }
    }
    if (tau < 0) return null

    // --- Step 4: parabolic interpolation around the dip for sub-sample tau ---
    let betterTau = tau
    if (tau - 1 >= 1 && tau + 1 <= tauMax) {
      const left = diff[tau - 1]
      const mid = diff[tau]
      const right = diff[tau + 1]
      const denom = 2 * (left - 2 * mid + right)
      if (Math.abs(denom) > 1e-12) {
        const delta = (left - right) / denom
        if (Math.abs(delta) <= 1) betterTau = tau + delta
      }
    }

    return {
      freq: this.sampleRate / betterTau,
      probability: 1 - Math.min(1, diff[tau]),
      rms,
    }
  }
}
