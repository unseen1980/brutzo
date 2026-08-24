import { YinPitchDetector, type PitchResult } from './pitch'
import { analyzeTimeDomain, rmsToDb, detectHum, type HumResult } from './detection'

/**
 * The shared analysis graph — THE node graph every audio feature runs through,
 * whether the source is the live microphone or a harness WAV (CLAUDE.md
 * verification rule: if a feature can't run from both, the design is wrong).
 *
 * Layout:
 *
 *   source(s) ──▶ inputBus ──▶ splitter ── ch0 ──▶ gateL ──┐
 *                             │            └─ chAnalyserL │▶ analyser (meter, YIN, hum FFT)
 *                             └── ch1 ──▶ gateR ──────────┘
 *                                 └─ chAnalyserR
 *
 * - Channel auto-selection compares per-channel RMS on chAnalyserL/R and
 *   opens/closes the gates — stereo inputs are never blindly summed.
 * - Analysis never connects directly to ctx.destination. Phase 1 monitoring may
 *   attach the selected analyser output to the opt-in ToneMonitor worklet.
 * - All scratch buffers are allocated once and reused; readFrame() performs
 *   no per-sample allocations.
 */

export interface AnalysisFrame {
  /** ctx.currentTime when the frame was read. */
  time: number
  /** Post-selection RMS, dBFS. */
  db: number
  /** Post-selection absolute peak (0..1). */
  peak: number
  /** Flat-topped peaks seen in this frame. */
  clipped: boolean
  /** Pre-selection per-channel RMS, dBFS ([left, right]). */
  channelDb: [number, number]
  /** Currently open channel. */
  selectedChannel: 0 | 1
  /** YIN estimate on the selected channel (null when gated off). */
  pitch: PitchResult | null
}

export interface ReadFrameOptions {
  /** Run YIN this frame (default true). Meters-only loops pass false. */
  withPitch?: boolean
}

const FFT_SIZE = 4096
const CHANNEL_FFT_SIZE = 1024
/**
 * Hum detection needs ~1.5 Hz bins to separate 50 Hz from 60 Hz, so the
 * spectrum analyser is much larger than the time-domain analyser. It is only
 * read during input checks (not per frame), so the cost is fine.
 */
const SPECTRUM_FFT_SIZE = 32768
/** Switch channels only after this many consecutive frames agree (hysteresis). */
const SWITCH_VOTES = 5
/** …and only when the other channel is this much louder, in dB. */
const SWITCH_MARGIN_DB = 6

export class AudioGraph {
  private readonly ctx: AudioContext
  private readonly inputBus: GainNode
  private readonly splitter: ChannelSplitterNode
  private readonly gateL: GainNode
  private readonly gateR: GainNode
  private readonly chAnalyserL: AnalyserNode
  private readonly chAnalyserR: AnalyserNode
  private readonly analyser: AnalyserNode
  private readonly spectrumAnalyser: AnalyserNode

  private selected: 0 | 1 = 0
  private votes = 0

  private readonly timeBuf: Float32Array<ArrayBuffer>
  private readonly chBuf: Float32Array<ArrayBuffer>
  private readonly freqBuf: Float32Array<ArrayBuffer>
  private readonly yin: YinPitchDetector
  private readonly sources = new Set<AudioNode>()

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.inputBus = ctx.createGain()
    this.splitter = ctx.createChannelSplitter(2)
    this.gateL = ctx.createGain()
    this.gateR = ctx.createGain()
    this.chAnalyserL = ctx.createAnalyser()
    this.chAnalyserR = ctx.createAnalyser()
    this.analyser = ctx.createAnalyser()
    this.spectrumAnalyser = ctx.createAnalyser()

    this.chAnalyserL.fftSize = CHANNEL_FFT_SIZE
    this.chAnalyserR.fftSize = CHANNEL_FFT_SIZE
    this.analyser.fftSize = FFT_SIZE
    this.spectrumAnalyser.fftSize = SPECTRUM_FFT_SIZE
    // Raw magnitudes: we do our own smoothing/decisions.
    this.analyser.smoothingTimeConstant = 0
    this.chAnalyserL.smoothingTimeConstant = 0
    this.chAnalyserR.smoothingTimeConstant = 0
    // Hum is steady; smoothing keeps the check stable between reads.
    this.spectrumAnalyser.smoothingTimeConstant = 0.8

    this.inputBus.connect(this.splitter)
    this.splitter.connect(this.gateL, 0)
    this.splitter.connect(this.gateR, 1)
    this.gateL.connect(this.analyser)
    this.gateR.connect(this.analyser)
    this.gateL.connect(this.spectrumAnalyser)
    this.gateR.connect(this.spectrumAnalyser)
    this.splitter.connect(this.chAnalyserL, 0)
    this.splitter.connect(this.chAnalyserR, 1)

    this.applyGates()

    this.timeBuf = new Float32Array(FFT_SIZE)
    this.chBuf = new Float32Array(CHANNEL_FFT_SIZE)
    this.freqBuf = new Float32Array(SPECTRUM_FFT_SIZE / 2)
    this.yin = new YinPitchDetector(ctx.sampleRate)
  }

  get sampleRate(): number {
    return this.ctx.sampleRate
  }

  get fftSize(): number {
    return FFT_SIZE
  }

  get selectedChannel(): 0 | 1 {
    return this.selected
  }


  /** Connects the already channel-selected signal to a downstream feature. */
  connectSelectedOutput(node: AudioNode): void {
    this.analyser.connect(node)
  }

  disconnectSelectedOutput(node: AudioNode): void {
    try {
      this.analyser.disconnect(node)
    } catch {
      // Already disconnected.
    }
  }

  /** Connects a source (MediaStreamAudioSourceNode or AudioBufferSourceNode). */
  connectSource(node: AudioNode): void {
    node.connect(this.inputBus)
    this.sources.add(node)
  }

  disconnectSource(node: AudioNode): void {
    try {
      node.disconnect(this.inputBus)
    } catch {
      // Already disconnected.
    }
    this.sources.delete(node)
  }

  disconnectAllSources(): void {
    for (const node of [...this.sources]) this.disconnectSource(node)
  }

  /** Force a channel (used when replaying a saved calibration profile). */
  setSelectedChannel(channel: 0 | 1): void {
    if (this.selected === channel) return
    this.selected = channel
    this.votes = 0
    this.applyGates()
  }

  private applyGates(): void {
    const now = this.ctx.currentTime
    // Short ramps avoid clicks on live sources.
    this.gateL.gain.setTargetAtTime(this.selected === 0 ? 1 : 0, now, 0.01)
    this.gateR.gain.setTargetAtTime(this.selected === 1 ? 1 : 0, now, 0.01)
  }


  private channelRmsDb(analyser: AnalyserNode): number {
    analyser.getFloatTimeDomainData(this.chBuf)
    let sumSq = 0
    for (let i = 0; i < this.chBuf.length; i++) {
      const x = this.chBuf[i]
      sumSq += x * x
    }
    return rmsToDb(Math.sqrt(sumSq / this.chBuf.length))
  }

  /** Reads one analysis frame. Poll from rAF/setInterval; no allocation per sample. */
  readFrame(opts: ReadFrameOptions = {}): AnalysisFrame {
    const dbL = this.channelRmsDb(this.chAnalyserL)
    const dbR = this.channelRmsDb(this.chAnalyserR)

    // Auto-select the live channel: never sum stereo blindly.
    const quieter = -70 // below this both channels count as silent
    if (dbL > quieter && dbR > quieter) {
      const otherIsLouder =
        this.selected === 0 ? dbR > dbL + SWITCH_MARGIN_DB : dbL > dbR + SWITCH_MARGIN_DB
      if (otherIsLouder) {
        this.votes++
        if (this.votes >= SWITCH_VOTES) {
          this.selected = this.selected === 0 ? 1 : 0
          this.votes = 0
          this.applyGates()
        }
      } else {
        this.votes = 0
      }
    }

    this.analyser.getFloatTimeDomainData(this.timeBuf)
    const stats = analyzeTimeDomain(this.timeBuf)
    const db = rmsToDb(stats.rms)

    let pitch: PitchResult | null = null
    if (opts.withPitch !== false && db > -55) {
      // Use the freshest samples: the tail of the analyser buffer.
      const start = this.timeBuf.length - this.yin.requiredLength
      if (start >= 0) {
        pitch = this.yin.detect(this.timeBuf, start)
      }
    }

    return {
      time: this.ctx.currentTime,
      db,
      peak: stats.peak,
      clipped: stats.clipped,
      channelDb: [dbL, dbR],
      selectedChannel: this.selected,
      pitch,
    }
  }

  /**
   * Current magnitude spectrum (dB) of the selected channel for hum analysis.
   * The returned buffer is reused internally — copy it if you need to keep it.
   */
  readSpectrum(): Float32Array {
    this.spectrumAnalyser.getFloatFrequencyData(this.freqBuf)
    return this.freqBuf
  }

  /** Convenience: hum check over the current spectrum. */
  checkHum(): HumResult | null {
    return detectHum(this.readSpectrum(), this.ctx.sampleRate, SPECTRUM_FFT_SIZE)
  }
}

