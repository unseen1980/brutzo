import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const clipsDir = fileURLToPath(new URL('../../../harness/clips', import.meta.url))

describe('harness clip manifest', () => {
  it('exists and references only files that are present', () => {
    const manifestPath = path.join(clipsDir, 'manifest.json')
    expect(existsSync(manifestPath), `${manifestPath} should exist`).toBe(true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      clips: Array<{ file: string; expectedHz: number; toleranceCents: number }>
    }
    expect(Array.isArray(manifest.clips)).toBe(true)
    expect(manifest.clips.length).toBeGreaterThanOrEqual(9)

    for (const clip of manifest.clips) {
      const file = path.join(clipsDir, clip.file)
      expect(existsSync(file), `${clip.file} listed in manifest but missing`).toBe(true)
      // Guitar range with headroom: low E 82 Hz up to ~660 Hz.
      expect(clip.expectedHz).toBeGreaterThan(60)
      expect(clip.expectedHz).toBeLessThan(700)
      expect(clip.toleranceCents).toBeGreaterThan(0)
      expect(clip.toleranceCents).toBeLessThanOrEqual(50)
    }
  })
})
