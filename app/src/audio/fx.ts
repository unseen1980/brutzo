export interface FxParams {
  gateEnabled: boolean
  gateThresholdDb: number
  slapEnabled: boolean
  slapTimeMs: number
  slapMix: number
  ambienceEnabled: boolean
  ambienceMix: number
  muted: boolean
}

export const DEFAULT_FX_PARAMS: FxParams = {
  gateEnabled: true,
  gateThresholdDb: -54,
  slapEnabled: false,
  slapTimeMs: 105,
  slapMix: 0,
  ambienceEnabled: false,
  ambienceMix: 0,
  muted: false,
}

export const POST_FX_HEADROOM = 0.5
export const MAX_PARALLEL_MIX_GAIN = 1 + 0.4 + 0.35

export function normalizeFxParams(params: FxParams): FxParams {
  const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback)
  return {
    gateEnabled: params.gateEnabled === true,
    gateThresholdDb: Math.max(-72, Math.min(-24, finite(params.gateThresholdDb, -72))),
    slapEnabled: params.slapEnabled === true,
    slapTimeMs: Math.max(50, Math.min(180, finite(params.slapTimeMs, 50))),
    slapMix: params.slapEnabled ? Math.max(0, Math.min(0.4, finite(params.slapMix, 0))) : 0,
    ambienceEnabled: params.ambienceEnabled === true,
    ambienceMix: params.ambienceEnabled ? Math.max(0, Math.min(0.35, finite(params.ambienceMix, 0))) : 0,
    muted: params.muted === true,
  }
}

/** Native Web Audio time-based effects. Core amp/gate/cab DSP stays in WASM. */
export class ToneFxGraph {
  readonly input: GainNode
  readonly output: GainNode
  private readonly dry: GainNode
  private readonly slapDelay: DelayNode
  private readonly slapFilter: BiquadFilterNode
  private readonly slapFeedback: GainNode
  private readonly slapWet: GainNode
  private readonly ambience: ConvolverNode
  private readonly ambienceWet: GainNode
  private readonly mixBus: GainNode
  private params: FxParams = DEFAULT_FX_PARAMS

  constructor(private readonly ctx: AudioContext) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.dry = ctx.createGain()
    this.slapDelay = ctx.createDelay(0.25)
    this.slapFilter = ctx.createBiquadFilter()
    this.slapFeedback = ctx.createGain()
    this.slapWet = ctx.createGain()
    this.ambience = ctx.createConvolver()
    this.ambienceWet = ctx.createGain()
    this.mixBus = ctx.createGain()

    this.dry.gain.value = 1
    this.slapFilter.type = 'lowpass'
    this.slapFilter.frequency.value = 3_800
    this.slapFeedback.gain.value = 0.16
    this.ambience.buffer = createAmbienceImpulse(ctx)
    this.mixBus.gain.value = POST_FX_HEADROOM

    this.input.connect(this.dry).connect(this.mixBus)
    this.input.connect(this.slapDelay).connect(this.slapFilter).connect(this.slapWet).connect(this.mixBus)
    this.slapFilter.connect(this.slapFeedback).connect(this.slapDelay)
    this.input.connect(this.ambience).connect(this.ambienceWet).connect(this.mixBus)
    this.mixBus.connect(this.output)
    this.setParams(DEFAULT_FX_PARAMS, true)
  }

  setParams(next: FxParams, immediate = false): FxParams {
    this.params = normalizeFxParams(next)
    const now = this.ctx.currentTime
    const ramp = immediate ? 0 : 0.02
    this.slapDelay.delayTime.setTargetAtTime(this.params.slapTimeMs / 1000, now, 0.01)
    setGain(this.slapWet.gain, this.params.slapMix, now, ramp)
    setGain(this.ambienceWet.gain, this.params.ambienceMix, now, ramp)
    setGain(this.output.gain, this.params.muted ? 0 : 1, now, ramp)
    return this.params
  }

  dispose(): void {
    for (const node of [
      this.input,
      this.dry,
      this.slapDelay,
      this.slapFilter,
      this.slapFeedback,
      this.slapWet,
      this.ambience,
      this.ambienceWet,
      this.mixBus,
      this.output,
    ]) node.disconnect()
  }
}

function setGain(param: AudioParam, value: number, now: number, ramp: number): void {
  param.cancelScheduledValues(now)
  if (ramp === 0) param.setValueAtTime(value, now)
  else param.setTargetAtTime(value, now, ramp)
}

function createAmbienceImpulse(ctx: AudioContext): AudioBuffer {
  const length = Math.max(1, Math.round(ctx.sampleRate * 0.32))
  const impulse = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = impulse.getChannelData(0)
  let filtered = 0
  for (let i = 0; i < length; i++) {
    const noise = Math.sin((i + 1) * 12.9898) * 43_758.5453
    const signed = (noise - Math.floor(noise)) * 2 - 1
    filtered += 0.18 * (signed - filtered)
    const decay = (1 - i / length) ** 2.6
    data[i] = filtered * decay * 0.7
  }
  data[0] = 1
  return impulse
}
