export interface ToneParams {
  drive: number
  tone: number
  level: number
}

export const TONE_PRESETS = {
  clean: { drive: 1.4, tone: 0.72, level: 0.72 },
  crunch: { drive: 4.5, tone: 0.62, level: 0.62 },
  lead: { drive: 8.5, tone: 0.55, level: 0.56 },
} as const satisfies Record<string, ToneParams>

export type TonePresetName = keyof typeof TONE_PRESETS
export const DEFAULT_TONE_PRESET: ToneParams = TONE_PRESETS.clean

export function normalizeToneParams(params: ToneParams): ToneParams {
  const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback)
  return {
    drive: Math.max(1, Math.min(12, finite(params.drive, 1))),
    tone: Math.max(0, Math.min(1, finite(params.tone, 0))),
    level: Math.max(0, Math.min(1, finite(params.level, 0))),
  }
}

interface ToneMessage {
  type: 'ready' | 'error'
  message?: string
}

export class ToneMonitor {
  private node: AudioWorkletNode | null = null
  private output: GainNode | null = null
  private params: ToneParams = DEFAULT_TONE_PRESET

  constructor(private readonly ctx: AudioContext) {}

  async initialize(processorUrl: string, wasmUrl: string): Promise<AudioWorkletNode> {
    if (this.node) return this.node
    const [wasmResponse] = await Promise.all([fetch(wasmUrl), this.ctx.audioWorklet.addModule(processorUrl)])
    if (!wasmResponse.ok) throw new Error(`Tone engine fetch failed: HTTP ${wasmResponse.status}`)
    const wasm = await wasmResponse.arrayBuffer()
    const node = new AudioWorkletNode(this.ctx, 'brutzo-tone', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    this.node = node
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Tone engine initialization timed out')), 5000)
        node.port.onmessage = (event: MessageEvent<ToneMessage>) => {
          if (event.data.type === 'ready') {
            window.clearTimeout(timeout)
            resolve()
          } else if (event.data.type === 'error') {
            window.clearTimeout(timeout)
            reject(new Error(event.data.message ?? 'Tone engine failed'))
          }
        }
        node.port.postMessage({ type: 'initialize', wasm }, [wasm])
      })
    } catch (error) {
      node.port.close()
      node.disconnect()
      this.node = null
      throw error
    }
    node.port.postMessage({ type: 'params', params: this.params })
    return node
  }

  connectOutput(): void {
    if (!this.node || this.output) return
    const output = this.ctx.createGain()
    output.gain.value = 0
    this.node.connect(output).connect(this.ctx.destination)
    output.gain.setTargetAtTime(1, this.ctx.currentTime, 0.015)
    this.output = output
  }

  disconnectOutput(): void {
    if (!this.output) return
    this.output.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01)
    const output = this.output
    window.setTimeout(() => output.disconnect(), 50)
    this.output = null
  }

  setParams(params: ToneParams): ToneParams {
    this.params = normalizeToneParams(params)
    this.node?.port.postMessage({ type: 'params', params: this.params })
    return this.params
  }

  dispose(): void {
    this.disconnectOutput()
    this.node?.port.close()
    this.node?.disconnect()
    this.node = null
  }
}
