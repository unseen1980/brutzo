import { describe, expect, it } from 'vitest'
import { DEFAULT_FX_PARAMS, MAX_PARALLEL_MIX_GAIN, POST_FX_HEADROOM, normalizeFxParams } from './fx'

describe('tone FX parameters', () => {
  it('ships bypassed time effects and an audible master by default', () => {
    expect(DEFAULT_FX_PARAMS).toMatchObject({
      gateEnabled: true,
      slapEnabled: false,
      ambienceEnabled: false,
      muted: false,
    })
  })

  it('clamps untrusted numeric values and preserves explicit switches', () => {
    expect(normalizeFxParams({
      gateEnabled: false,
      gateThresholdDb: Number.NEGATIVE_INFINITY,
      slapEnabled: true,
      slapTimeMs: 999,
      slapMix: 2,
      ambienceEnabled: true,
      ambienceMix: Number.NaN,
      muted: true,
    })).toEqual({
      gateEnabled: false,
      gateThresholdDb: -72,
      slapEnabled: true,
      slapTimeMs: 180,
      slapMix: 0.4,
      ambienceEnabled: true,
      ambienceMix: 0,
      muted: true,
    })
  })

  it('forces wet levels to zero while an effect is bypassed', () => {
    const normalized = normalizeFxParams({
      ...DEFAULT_FX_PARAMS,
      slapEnabled: false,
      slapMix: 0.3,
      ambienceEnabled: false,
      ambienceMix: 0.2,
    })
    expect(normalized.slapMix).toBe(0)
    expect(normalized.ambienceMix).toBe(0)
  })

  it('keeps the maximum direct parallel mix below full scale before limiting', () => {
    expect(POST_FX_HEADROOM * MAX_PARALLEL_MIX_GAIN).toBeLessThan(1)
  })
})
