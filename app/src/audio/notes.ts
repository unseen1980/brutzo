/** Note/frequency math. Equal temperament, A4 = 440 Hz. */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
export const A4_HZ = 440
export const A4_MIDI = 69

export function midiToFreq(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12)
}

/** Nearest note to a frequency, plus the signed cents deviation from it. */
export function freqToNearestNote(freq: number): { midi: number; note: string; cents: number } {
  const exact = A4_MIDI + 12 * Math.log2(freq / A4_HZ)
  const midi = Math.round(exact)
  return { midi, note: midiToNoteName(midi), cents: (exact - midi) * 100 }
}

export function midiToNoteName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${name}${octave}`
}

/** Signed cents from `reference` to `freq` (positive = sharp). */
export function centsBetween(freq: number, reference: number): number {
  return 1200 * Math.log2(freq / reference)
}

export interface OpenString {
  label: string
  midi: number
  note: string
  freq: number
}

/** Standard tuning, low to high. The tuner must stay accurate down to E2 (82.41 Hz). */
export const GUITAR_OPEN_STRINGS: OpenString[] = [
  { label: '6', midi: 40, note: 'E2', freq: midiToFreq(40) },
  { label: '5', midi: 45, note: 'A2', freq: midiToFreq(45) },
  { label: '4', midi: 50, note: 'D3', freq: midiToFreq(50) },
  { label: '3', midi: 55, note: 'G3', freq: midiToFreq(55) },
  { label: '2', midi: 59, note: 'B3', freq: midiToFreq(59) },
  { label: '1', midi: 64, note: 'E4', freq: midiToFreq(64) },
]

/** The open string a frequency is closest to (by cents), or null if far from all. */
export function nearestString(freq: number, maxCents = 250): OpenString | null {
  let best: OpenString | null = null
  let bestAbs = Infinity
  for (const s of GUITAR_OPEN_STRINGS) {
    const abs = Math.abs(centsBetween(freq, s.freq))
    if (abs < bestAbs) {
      bestAbs = abs
      best = s
    }
  }
  return bestAbs <= maxCents ? best : null
}
