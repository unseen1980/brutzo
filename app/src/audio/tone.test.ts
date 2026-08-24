import { describe, expect, it } from 'vitest'
import { DEFAULT_TONE_PRESET, TONE_PRESETS, normalizeToneParams } from './tone'

describe('tone parameters', () => {
  it('ships a safe default preset', () => {
    expect(DEFAULT_TONE_PRESET).toEqual(TONE_PRESETS.clean)
    expect(DEFAULT_TONE_PRESET.level).toBeLessThanOrEqual(0.8)
  })

  it('clamps untrusted UI values to the DSP ABI', () => {
    expect(normalizeToneParams({ drive: 99, tone: -1, level: Number.NaN })).toEqual({
      drive: 12,
      tone: 0,
      level: 0,
    })
  })

  it('defines distinct clean, crunch, and lead sounds', () => {
    expect(Object.keys(TONE_PRESETS)).toEqual(['clean', 'crunch', 'lead'])
    expect(TONE_PRESETS.clean.drive).toBeLessThan(TONE_PRESETS.crunch.drive)
    expect(TONE_PRESETS.crunch.drive).toBeLessThan(TONE_PRESETS.lead.drive)
  })
})
