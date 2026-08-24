import { describe, expect, it } from 'vitest'
import { createTakeMetadata, encodeMonoWav, safeTakeFilename, sortTakesNewestFirst, takeFileName } from './recorder'
import { DEFAULT_TONE_PRESET } from './tone'
import { DEFAULT_FX_PARAMS } from './fx'

describe('processed take recorder', () => {
  it('encodes mono 16-bit PCM WAV with bounded samples', () => {
    const wav = encodeMonoWav([new Float32Array([-2, -1, 0, 0.5, 1, 2])], 48_000)
    const view = new DataView(wav)
    const text = (offset: number, length: number) => String.fromCharCode(...new Uint8Array(wav, offset, length))
    expect(text(0, 4)).toBe('RIFF')
    expect(text(8, 4)).toBe('WAVE')
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(48_000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(12)
    expect(view.getInt16(44, true)).toBe(-32768)
    expect(view.getInt16(54, true)).toBe(32767)
  })

  it('creates complete local-only take metadata', () => {
    expect(createTakeMetadata({
      id: 'take-1',
      name: 'First riff',
      createdAt: 1_000,
      frames: 96_000,
      sampleRate: 48_000,
      preset: 'crunch',
      tone: DEFAULT_TONE_PRESET,
      fx: DEFAULT_FX_PARAMS,
      latencyMs: 18,
      deviceLabel: 'Katana USB',
    })).toMatchObject({ id: 'take-1', durationMs: 2_000, preset: 'crunch', deviceLabel: 'Katana USB' })
  })

  it('sanitizes download names and sorts newest first', () => {
    expect(safeTakeFilename('  My / riff 🎸  ')).toBe('my-riff.wav')
    expect(takeFileName('../../take:1')).toBe('take-1.wav')
    const older = createTakeMetadata({ id: 'a', name: 'a', createdAt: 1, frames: 1, sampleRate: 1, preset: 'clean', tone: DEFAULT_TONE_PRESET, fx: DEFAULT_FX_PARAMS, latencyMs: null, deviceLabel: '' })
    const newer = { ...older, id: 'b', createdAt: 2 }
    expect(sortTakesNewestFirst([older, newer]).map((take) => take.id)).toEqual(['b', 'a'])
  })
})
