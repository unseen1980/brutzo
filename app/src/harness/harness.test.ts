import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { YinPitchDetector } from '../audio/pitch'
import { centsBetween } from '../audio/notes'
import { median } from '../audio/stats'

/**
 * Headless harness runner — the qa-harness subagent's "run the clip harness in
 * headless mode" requirement.
 *
 * The browser harness (#/harness) proves the clips survive the full Web Audio
 * graph; this test proves the DSP verdict itself is stable, on every push,
 * with zero clicks. It decodes the actual WAV files from /harness/clips,
 * steps through them at the same 40 ms cadence as the browser poll, runs the
 * real YinPitchDetector, and applies the manifest tolerances.
 *
 * One honest difference: the browser decodes through the AudioContext
 * (resampling to ctx.sampleRate); headless runs at the file's native rate.
 * YIN's output in Hz is sample-rate independent, so both paths must agree
 * well inside the manifest tolerances — if they ever don't, that's a bug.
 */

interface ManifestClip {
  file: string
  expectedHz: number
  expectedNote: string
  toleranceCents: number
  description: string
}

interface Manifest {
  version: number
  description: string
  clips: ManifestClip[]
}

interface WavData {
  sampleRate: number
  /** The louder channel by RMS — mirrors the graph's channel auto-select. */
  samples: Float32Array
  channels: number
}

/** Minimal RIFF/WAVE parser: PCM 8/16/24-bit and IEEE float 32-bit. */
function parseWav(buf: Buffer): WavData {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file')
  }
  let format = -1
  let channels = 1
  let sampleRate = 44100
  let bitsPerSample = 16
  let dataStart = -1
  let dataLength = 0

  let offset = 12
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      format = buf.readUInt16LE(offset + 8)
      channels = buf.readUInt16LE(offset + 10)
      sampleRate = buf.readUInt32LE(offset + 12)
      bitsPerSample = buf.readUInt16LE(offset + 22)
    } else if (id === 'data') {
      dataStart = offset + 8
      dataLength = Math.min(size, buf.length - dataStart)
      break
    }
    offset += 8 + size + (size % 2) // RIFF chunks are word-aligned
  }
  if (dataStart < 0) throw new Error('WAV has no data chunk')
  if (format !== 1 && format !== 3) throw new Error(`unsupported WAV format tag ${format}`)

  const bytesPerSample = bitsPerSample / 8
  const frameCount = Math.floor(dataLength / (bytesPerSample * channels))
  const decoded: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(frameCount))

  for (let frame = 0; frame < frameCount; frame++) {
    for (let ch = 0; ch < channels; ch++) {
      const pos = dataStart + (frame * channels + ch) * bytesPerSample
      let value: number
      if (format === 3 && bitsPerSample === 32) {
        value = buf.readFloatLE(pos)
      } else if (format === 1 && bitsPerSample === 16) {
        value = buf.readInt16LE(pos) / 32768
      } else if (format === 1 && bitsPerSample === 8) {
        value = (buf.readUInt8(pos) - 128) / 128
      } else if (format === 1 && bitsPerSample === 24) {
        const b0 = buf.readUInt8(pos)
        const b1 = buf.readUInt8(pos + 1)
        const b2 = buf.readInt8(pos + 2)
        value = ((b2 << 16) | (b1 << 8) | b0) / 8388608
      } else {
        throw new Error(`unsupported WAV encoding: format ${format}, ${bitsPerSample}-bit`)
      }
      decoded[ch][frame] = value
    }
  }

  // Pick the channel with the highest RMS — same rule as AudioGraph's
  // channel auto-selection (never blindly sum stereo).
  let loudest = 0
  let loudestRms = -1
  for (let ch = 0; ch < channels; ch++) {
    let sumSq = 0
    for (let i = 0; i < decoded[ch].length; i++) sumSq += decoded[ch][i] * decoded[ch][i]
    const rms = sumSq / decoded[ch].length
    if (rms > loudestRms) {
      loudestRms = rms
      loudest = ch
    }
  }
  return { sampleRate, samples: decoded[loudest], channels }
}


interface ClipVerdict {
  clip: ManifestClip
  detectedHz: number | null
  cents: number | null
  frames: number
  pass: boolean
}

/** Steps the detector through a clip at the browser harness's 40 ms cadence. */
function runClip(wav: WavData): { estimates: number[] } {
  const detector = new YinPitchDetector(wav.sampleRate)
  const estimates: number[] = []
  const step = Math.round(wav.sampleRate * 0.04)
  for (let start = 0; start + detector.requiredLength <= wav.samples.length; start += step) {
    const r = detector.detect(wav.samples, start)
    // Same gate as the browser harness: confidence >= 0.6.
    if (r && r.probability >= 0.6) estimates.push(r.freq)
  }
  return { estimates }
}

const clipsDir = fileURLToPath(new URL('../../../harness/clips', import.meta.url))

describe('reference-clip harness (headless)', () => {
  const manifestPath = path.join(clipsDir, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest

  const verdicts: ClipVerdict[] = manifest.clips.map((clip) => {
    const file = path.join(clipsDir, clip.file)
    if (!existsSync(file)) {
      return { clip, detectedHz: null, cents: null, frames: 0, pass: false }
    }
    try {
      const wav = parseWav(readFileSync(file))
      const { estimates } = runClip(wav)
      const detected = median(estimates)
      if (detected === null || estimates.length < 5) {
        return { clip, detectedHz: null, cents: null, frames: estimates.length, pass: false }
      }
      const cents = centsBetween(detected, clip.expectedHz)
      return {
        clip,
        detectedHz: detected,
        cents,
        frames: estimates.length,
        pass: Math.abs(cents) <= clip.toleranceCents,
      }
    } catch (e) {
      // Corrupt/unsupported file: fail this clip loudly but let the suite report.
      console.warn(`harness (headless): could not process ${clip.file}:`, e)
      return { clip, detectedHz: null, cents: null, frames: 0, pass: false }
    }
  })

  it('has a non-empty manifest and every listed clip file present', () => {
    expect(manifest.clips.length).toBeGreaterThan(0)
    for (const v of verdicts) {
      expect(existsSync(path.join(clipsDir, v.clip.file)), `${v.clip.file} is missing`).toBe(true)
    }
  })

  it('finds a stable pitch in every clip (>= 5 confident frames)', () => {
    for (const v of verdicts) {
      expect(v.frames, `${v.clip.file}: only ${v.frames} confident frames`).toBeGreaterThanOrEqual(5)
      expect(v.detectedHz, `${v.clip.file}: no pitch detected`).not.toBeNull()
    }
  })

  it('meets the Phase 0 exit criterion: >= 95% note accuracy', () => {
    const lines = verdicts.map((v) => {
      const cents = v.cents === null ? '—' : `${v.cents > 0 ? '+' : ''}${v.cents.toFixed(1)}`
      const det = v.detectedHz === null ? '—' : `${v.detectedHz.toFixed(2)} Hz`
      return `  ${v.pass ? 'PASS' : 'FAIL'}  ${v.clip.file.padEnd(18)} expected ${v.clip.expectedHz.toFixed(2)} Hz  detected ${det.padStart(10)}  ${cents.padStart(7)} cents  (${v.frames} frames)`
    })
    console.log(['harness (headless) verdicts:', ...lines].join('\n'))

    const passed = verdicts.filter((v) => v.pass).length
    const rate = (passed / verdicts.length) * 100
    console.log(`harness (headless): ${passed}/${verdicts.length} clips passed (${rate.toFixed(0)}%)`)
    expect(rate, `${verdicts.filter((v) => !v.pass).map((v) => v.clip.file).join(', ')} failed`).toBeGreaterThanOrEqual(95)
  })

  it('keeps each clip within its manifest tolerance (regression record)', () => {
    for (const v of verdicts) {
      expect(
        v.cents !== null && Math.abs(v.cents) <= v.clip.toleranceCents,
        `${v.clip.file}: ${v.cents?.toFixed(1)} cents vs ${v.clip.toleranceCents} tolerance`,
      ).toBe(true)
    }
  })
})
