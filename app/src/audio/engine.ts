import { AudioGraph } from './graph'
import { InputController, type OpenInputResult } from './input'

export interface LatencyInfo {
  /** AudioContext.baseLatency in ms (browser-reported output-side base). */
  baseMs: number | null
  /** AudioContext.outputLatency in ms — grows large on Bluetooth outputs. */
  outputMs: number | null
  /** Browser-reported output-path estimate. This is not a measured hardware round trip. */
  browserEstimateMs: number | null
  /** True when the numbers or device labels look like a Bluetooth output. */
  bluetoothSuspected: boolean
  /** Output device labels seen (for the wizard summary). */
  outputLabels: string[]
}

/** Above this outputLatency (ms) we assume a Bluetooth link is in the path. */
const BLUETOOTH_LATENCY_MS = 120
const BLUETOOTH_LABEL_RE = /bluetooth|airpods|airpod|\bbuds\b|wf-1000|momentum t/i

/**
 * Single shared engine: one AudioContext, one AudioGraph, one input
 * controller. Both live input and harness WAV playback attach sources to the
 * same graph instance.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null
  private graph: AudioGraph | null = null
  private liveSource: MediaStreamAudioSourceNode | null = null
  readonly input = new InputController()

  get context(): AudioContext | null {
    return this.ctx
  }

  get audioGraph(): AudioGraph | null {
    return this.graph
  }

  /** Creates/resumes the context. Must be called from a user gesture. */
  ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 0 })
      this.graph = new AudioGraph(this.ctx)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  /** Opens the live input and attaches it to the graph. */
  async openLiveInput(deviceId: string | null): Promise<OpenInputResult> {
    const ctx = this.ensureContext()
    const result = await this.input.open(deviceId)
    this.closeLiveSource()
    this.liveSource = ctx.createMediaStreamSource(result.stream)
    this.graph!.connectSource(this.liveSource)
    return result
  }

  async closeLiveInput(): Promise<void> {
    this.closeLiveSource()
    await this.input.close()
  }

  private closeLiveSource(): void {
    if (this.liveSource && this.graph) {
      this.graph.disconnectSource(this.liveSource)
    }
    this.liveSource = null
  }

  /**
   * Decodes a WAV/PCM file and returns the AudioBuffer at the context's
   * sample rate (decodeAudioData resamples for us — the detector always uses
   * ctx.sampleRate, never an assumed 44.1k).
   */
  async decodeAudioFile(data: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.ensureContext()
    return ctx.decodeAudioData(data)
  }

  async latencyInfo(): Promise<LatencyInfo> {
    const baseMs = this.ctx ? this.ctx.baseLatency * 1000 : null
    // outputLatency can be 0 until audio has actually played; report what we see.
    const outputMs = this.ctx && this.ctx.outputLatency > 0 ? this.ctx.outputLatency * 1000 : null
    // A base-only number is incomplete and must not be graded against the
    // physical 30 ms target as if it covered the full browser output path.
    const browserEstimateMs = baseMs !== null && outputMs !== null ? baseMs + outputMs : null

    let outputLabels: string[] = []
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      outputLabels = devices
        .filter((d) => d.kind === 'audiooutput')
        .map((d) => d.label)
        .filter(Boolean)
    } catch {
      // Enumeration needs no permission in Chrome, but never fail on it.
    }
    const bluetoothSuspected =
      (outputMs !== null && outputMs > BLUETOOTH_LATENCY_MS) ||
      outputLabels.some((l) => BLUETOOTH_LABEL_RE.test(l))

    return { baseMs, outputMs, browserEstimateMs, bluetoothSuspected, outputLabels }
  }
}

let singleton: AudioEngine | null = null

export function getEngine(): AudioEngine {
  singleton ??= new AudioEngine()
  return singleton
}
