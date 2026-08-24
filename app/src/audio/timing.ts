/**
 * Timing-calibration helpers. Pure functions so the onset/click pairing is
 * unit-testable headlessly (same principle as the rest of the DSP core).
 */

/**
 * Pairs each metronome click with its closest detected onset, ignoring
 * anything more than `halfBeat` seconds away.
 *
 * Returns per-pair offsets in milliseconds (onset − click; positive = late).
 * Robust to:
 *  - missed strums: the click simply has no nearby onset and is skipped
 *  - double triggers: an extra onset is never the closest to any click
 *  - pre-roll noise: onsets before the first click have nothing to pair with
 */
export function pairOnsetsToClicks(
  onsets: number[],
  clicks: number[],
  halfBeat: number,
): number[] {
  const offsets: number[] = []
  for (const click of clicks) {
    let best: number | null = null
    let bestAbs = Infinity
    for (const onset of onsets) {
      const abs = Math.abs(onset - click)
      if (abs < bestAbs) {
        bestAbs = abs
        best = onset
      }
    }
    if (best !== null && bestAbs <= halfBeat) offsets.push((best - click) * 1000)
  }
  return offsets
}
