/** Small statistics helpers for calibration measurements. */

/** Median of a sample; null for empty input. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Linear-interpolated quantile (type 7) of an UNSORTED sample. */
export function quantile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const pos = (s.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return s[lo]
  return s[lo] + (pos - lo) * (s[hi] - s[lo])
}

/** Interquartile range (q3 − q1) of a sample; null for empty input. */
export function iqr(values: number[]): number | null {
  const q1 = quantile(values, 0.25)
  const q3 = quantile(values, 0.75)
  if (q1 === null || q3 === null) return null
  return q3 - q1
}
