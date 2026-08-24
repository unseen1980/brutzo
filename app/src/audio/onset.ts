/**
 * RMS-envelope onset detection for the timing-calibration step.
 *
 * The envelope attacks instantly and releases slowly, so a strum on top of a
 * still-ringing string still registers as a rise. Onset time is quantized to
 * the polling interval (rAF ≈ 16 ms); the wizard's median-over-8-strums
 * keeps that error small. This is Phase-0 honest measurement, not research
 * onset detection.
 */

export interface Onset {
  /** Context time of the frame where the rise was detected. */
  time: number
  /** Level of the onset frame, dBFS. */
  db: number
}

export interface OnsetTrackerOptions {
  /** Minimum time between onsets, ms (default 180). */
  refractoryMs?: number
  /** Rise over the (released) envelope that counts as an onset, dB (default 6). */
  riseDb?: number
  /** Absolute floor: onsets below this dBFS are ignored (default -42). */
  minDb?: number
  /** Envelope release, dB per frame (default 1.0 — ~30 dB/s at 30 fps). */
  releaseDbPerFrame?: number
}

export class OnsetTracker {
  private envelopeDb = -100
  private lastOnsetTime = -Infinity

  private readonly refractoryS: number
  private readonly riseDb: number
  private readonly minDb: number
  private readonly releaseDbPerFrame: number

  constructor(opts: OnsetTrackerOptions = {}) {
    this.refractoryS = (opts.refractoryMs ?? 180) / 1000
    this.riseDb = opts.riseDb ?? 6
    this.minDb = opts.minDb ?? -42
    this.releaseDbPerFrame = opts.releaseDbPerFrame ?? 1.0
  }

  reset(): void {
    this.envelopeDb = -100
    this.lastOnsetTime = -Infinity
  }

  /** Feed one analysis frame; returns an onset when a rise is detected. */
  feed(frame: { time: number; db: number }): Onset | null {
    let onset: Onset | null = null
    if (
      frame.db > this.minDb &&
      frame.db > this.envelopeDb + this.riseDb &&
      frame.time - this.lastOnsetTime > this.refractoryS
    ) {
      onset = { time: frame.time, db: frame.db }
      this.lastOnsetTime = frame.time
    }
    // Attack instantly, release slowly.
    this.envelopeDb =
      frame.db > this.envelopeDb ? frame.db : this.envelopeDb - this.releaseDbPerFrame
    if (this.envelopeDb < -100) this.envelopeDb = -100
    return onset
  }
}
