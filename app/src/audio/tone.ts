import { DEFAULT_FX_PARAMS, normalizeFxParams, ToneFxGraph, type FxParams } from './fx'

export interface ToneParams {
  inputTrimDb: number
  drive: number
  tone: number
  cabinet: number
  level: number
}

export const TONE_PRESETS = {
  clean: { inputTrimDb: -2, drive: 1.5, tone: 0.72, cabinet: 0.3, level: 0.72 },
  crunch: { inputTrimDb: 0, drive: 4.8, tone: 0.6, cabinet: 0.58, level: 0.62 },
  lead: { inputTrimDb: 2, drive: 8.8, tone: 0.52, cabinet: 0.82, level: 0.54 },
} as const satisfies Record<string, ToneParams>

export type TonePresetName = keyof typeof TONE_PRESETS
export const DEFAULT_TONE_PRESET: ToneParams = TONE_PRESETS.clean

export function normalizeToneParams(params: ToneParams): ToneParams {
  const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback)
  return {
    inputTrimDb: Math.max(-18, Math.min(12, finite(params.inputTrimDb, 0))),
    drive: Math.max(1, Math.min(12, finite(params.drive, 1))),
    tone: Math.max(0, Math.min(1, finite(params.tone, 0))),
    cabinet: Math.max(0, Math.min(1, finite(params.cabinet, 0))),
    level: Math.max(0, Math.min(1, finite(params.level, 0))),
  }
}

interface ToneMessage {
  type: 'ready' | 'error'
  message?: string
}

export interface RecordingResult {
  chunks: Float32Array[]
  frames: number
  sampleRate: number
  droppedFrames: number
}

export class ToneMonitor {
  private node: AudioWorkletNode | null = null
  private fx: ToneFxGraph | null = null
  private recorder: AudioWorkletNode | null = null
  private recorderSink: GainNode | null = null
  private recording = false
  private recordChunks: Float32Array[] = []
  private stopRecordingResolve: ((result: RecordingResult) => void) | null = null
  private stopRecordingReject: ((error: Error) => void) | null = null
  private stopRecordingPromise: Promise<RecordingResult> | null = null
  private stopRecordingTimer: number | null = null
  private disconnectTimer: number | null = null
  private connected = false
  private disposed = false
  private params: ToneParams = DEFAULT_TONE_PRESET
  private fxParams: FxParams = DEFAULT_FX_PARAMS

  constructor(private readonly ctx: AudioContext) {}

  async initialize(processorUrl: string, wasmUrl: string): Promise<AudioWorkletNode> {
    if (this.disposed) throw cancelledError('Tone engine was closed during startup.')
    if (this.node) return this.node
    const [wasmResponse] = await Promise.all([fetch(wasmUrl), this.ctx.audioWorklet.addModule(processorUrl)])
    if (this.disposed) throw cancelledError('Tone engine was closed during startup.')
    if (!wasmResponse.ok) throw new Error(`Tone engine fetch failed: HTTP ${wasmResponse.status}`)
    const wasm = await wasmResponse.arrayBuffer()
    const node = new AudioWorkletNode(this.ctx, 'brutzo-tone', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    this.node = node
    this.fx = new ToneFxGraph(this.ctx)
    node.connect(this.fx.input)
    const recorder = new AudioWorkletNode(this.ctx, 'brutzo-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })
    const recorderSink = this.ctx.createGain()
    recorderSink.gain.value = 0
    this.fx.output.connect(recorder).connect(recorderSink).connect(this.ctx.destination)
    recorder.port.onmessage = (event: MessageEvent<{ type: string; data?: Float32Array; frames?: number; droppedFrames?: number }>) => {
      if (event.data.type === 'record-chunk' && event.data.data) {
        const buffer = event.data.data.buffer
        this.recordChunks.push(new Float32Array(event.data.data.subarray(0, event.data.frames)))
        recorder.port.postMessage({ type: 'record-buffer', buffer }, [buffer])
      }
      if (event.data.type === 'record-stopped') {
        if (this.stopRecordingTimer !== null) window.clearTimeout(this.stopRecordingTimer)
        this.stopRecordingTimer = null
        this.recording = false
        this.stopRecordingResolve?.({
          chunks: this.recordChunks,
          frames: event.data.frames ?? this.recordChunks.reduce((sum, chunk) => sum + chunk.length, 0),
          sampleRate: this.ctx.sampleRate,
          droppedFrames: event.data.droppedFrames ?? 0,
        })
        this.stopRecordingResolve = null
        this.stopRecordingReject = null
        this.stopRecordingPromise = null
      }
    }
    this.recorder = recorder
    this.recorderSink = recorderSink
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
      recorder.port.close()
      recorder.disconnect()
      recorderSink.disconnect()
      this.fx.dispose()
      this.node = null
      this.fx = null
      this.recorder = null
      this.recorderSink = null
      throw error
    }
    this.postParams()
    return node
  }

  connectOutput(): void {
    if (!this.fx || this.connected) return
    if (this.disconnectTimer !== null) window.clearTimeout(this.disconnectTimer)
    this.disconnectTimer = null
    this.fx.setParams(this.fxParams)
    this.fx.output.connect(this.ctx.destination)
    this.connected = true
  }

  disconnectOutput(): void {
    if (!this.fx || !this.connected) return
    this.fx.setParams({ ...this.fxParams, muted: true })
    const fx = this.fx
    this.disconnectTimer = window.setTimeout(() => {
      fx.output.disconnect(this.ctx.destination)
      this.disconnectTimer = null
    }, 50)
    this.connected = false
  }

  setParams(params: ToneParams): ToneParams {
    this.params = normalizeToneParams(params)
    this.postParams()
    return this.params
  }

  setFxParams(params: FxParams): FxParams {
    this.fxParams = normalizeFxParams(params)
    this.fx?.setParams(this.fxParams)
    this.postParams()
    return this.fxParams
  }

  startRecording(): void {
    if (!this.connected || !this.recorder) throw new Error('Start monitoring before recording a take.')
    if (this.recording) throw new Error('A take is already recording.')
    this.recordChunks = []
    this.recording = true
    this.recorder.port.postMessage({ type: 'record-start' })
  }

  stopRecording(): Promise<RecordingResult> {
    if (this.stopRecordingPromise) return this.stopRecordingPromise
    if (!this.recording || !this.recorder) return Promise.reject(new Error('No take is recording.'))
    this.stopRecordingPromise = new Promise((resolve, reject) => {
      this.stopRecordingResolve = resolve
      this.stopRecordingReject = reject
      this.stopRecordingTimer = window.setTimeout(() => {
        this.recording = false
        this.stopRecordingResolve = null
        this.stopRecordingReject?.(new Error('Recorder did not stop in time.'))
        this.stopRecordingReject = null
        this.stopRecordingPromise = null
        this.stopRecordingTimer = null
      }, 3000)
      this.recorder!.port.postMessage({ type: 'record-stop' })
    })
    return this.stopRecordingPromise
  }

  private postParams(): void {
    this.node?.port.postMessage({ type: 'params', params: { ...this.params, ...this.fxParams } })
  }

  dispose(): void {
    this.disposed = true
    if (this.stopRecordingTimer !== null) window.clearTimeout(this.stopRecordingTimer)
    this.stopRecordingTimer = null
    if (this.disconnectTimer !== null) window.clearTimeout(this.disconnectTimer)
    this.disconnectTimer = null
    this.stopRecordingReject?.(new Error('Recorder was closed before the take was saved.'))
    this.stopRecordingResolve = null
    this.stopRecordingReject = null
    this.stopRecordingPromise = null
    if (this.fx && this.connected) {
      this.fx.setParams({ ...this.fxParams, muted: true }, true)
      try {
        this.fx.output.disconnect(this.ctx.destination)
      } catch {
        // Already disconnected.
      }
    }
    this.connected = false
    this.node?.port.close()
    this.node?.disconnect()
    this.recorder?.port.close()
    this.recorder?.disconnect()
    this.recorderSink?.disconnect()
    this.fx?.dispose()
    this.node = null
    this.fx = null
    this.recorder = null
    this.recorderSink = null
    this.recording = false
    this.stopRecordingResolve = null
  }
}

function cancelledError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}
