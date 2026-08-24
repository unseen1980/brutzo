import type { FxParams } from './fx'
import type { ToneParams, TonePresetName } from './tone'

export interface TakeMetadata {
  id: string
  name: string
  createdAt: number
  durationMs: number
  sampleRate: number
  preset: TonePresetName
  tone: ToneParams
  fx: FxParams
  latencyMs: number | null
  deviceLabel: string
}

export interface StoredTake extends TakeMetadata {
  wav: Blob
}

interface TakeMetadataInput extends Omit<TakeMetadata, 'durationMs'> {
  frames: number
}

export function createTakeMetadata(input: TakeMetadataInput): TakeMetadata {
  const { frames, ...metadata } = input
  return {
    ...metadata,
    name: input.name.trim() || 'Untitled take',
    durationMs: input.sampleRate > 0 ? Math.round((frames / input.sampleRate) * 1000) : 0,
    tone: { ...input.tone },
    fx: { ...input.fx },
  }
}

export function encodeMonoWav(chunks: Float32Array[], sampleRate: number): ArrayBuffer {
  const frames = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const buffer = new ArrayBuffer(44 + frames * 2)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + frames * 2, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, frames * 2, true)

  let offset = 44
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const sample = Math.max(-1, Math.min(1, Number.isFinite(chunk[i]) ? chunk[i] : 0))
      view.setInt16(offset, sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), true)
      offset += 2
    }
  }
  return buffer
}

export function safeTakeFilename(name: string): string {
  const stem = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
  return `${stem || 'brutzo-take'}.wav`
}

export function takeFileName(id: string): string {
  const stem = id.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100)
  return `${stem || 'take'}.wav`
}

export function sortTakesNewestFirst<T extends TakeMetadata>(takes: T[]): T[] {
  return [...takes].sort((a, b) => b.createdAt - a.createdAt)
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
}
