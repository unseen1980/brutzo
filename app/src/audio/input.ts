/**
 * Live input control — implements the non-negotiable audio input rules from
 * CLAUDE.md:
 *  - getUserMedia with echoCancellation/noiseSuppression/autoGainControl false
 *  - verify via track.getSettings() that they are ACTUALLY off; expose problems
 *  - pin deviceId explicitly
 *  - listen for devicechange (hot-plug) and track end (unplug)
 */

export interface DeviceInfo {
  deviceId: string
  label: string
}

export interface ProcessingCheck {
  /** What we requested (constant — the rules). */
  requested: { echoCancellation: false; noiseSuppression: false; autoGainControl: false }
  /** What the track reports after opening. undefined = browser did not report. */
  actual: {
    echoCancellation?: boolean
    noiseSuppression?: boolean
    autoGainControl?: boolean
  }
  /** True only when all three verifiably read back as false. */
  verified: boolean
  /** Human-readable problems; empty when verified. */
  problems: string[]
}

export interface OpenInputResult {
  stream: MediaStream
  /** The deviceId the track reports (may differ from requested after defaults). */
  deviceId: string | null
  label: string
  check: ProcessingCheck
}

export type InputEvent =
  | { type: 'devices-changed'; devices: DeviceInfo[] }
  | { type: 'device-lost' }

export class InputController {
  private stream: MediaStream | null = null
  private track: MediaStreamTrack | null = null
  private onTrackEnded: (() => void) | null = null
  private boundOnDeviceChange: (() => void) | null = null

  /** Called on devicechange / unplug. Set by the UI for hot-plug handling. */
  onEvent: ((event: InputEvent) => void) | null = null

  private async devices(): Promise<DeviceInfo[]> {
    const all = await navigator.mediaDevices.enumerateDevices()
    return all
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Microphone (name hidden until access is granted)' }))
  }

  async listDevices(): Promise<DeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return []
    return this.devices()
  }

  /**
   * Opens an input. Pass a deviceId to pin it explicitly, or null for the
   * system default (the laptop-mic demo mode).
   */
  async open(deviceId: string | null): Promise<OpenInputResult> {
    await this.close()
    const audio: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    }
    if (deviceId) audio.deviceId = { exact: deviceId }

    const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false })
    const track = stream.getAudioTracks()[0]
    if (!track) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error('Opened stream has no audio track')
    }

    // --- Verification: the constraints were REQUESTED, now confirm they took. ---
    const s = track.getSettings()
    const actual = {
      echoCancellation: s.echoCancellation,
      noiseSuppression: s.noiseSuppression,
      autoGainControl: s.autoGainControl,
    }
    const problems: string[] = []
    const expected: Array<[keyof typeof actual, string]> = [
      ['echoCancellation', 'echo cancellation'],
      ['noiseSuppression', 'noise suppression'],
      ['autoGainControl', 'automatic gain control'],
    ]
    for (const [key, label] of expected) {
      if (actual[key] === true) problems.push(`${label} is ON — the browser ignored our request`)
      else if (actual[key] === undefined) problems.push(`${label} state not reported by this browser`)
    }

    this.stream = stream
    this.track = track
    this.startListening()

    return {
      stream,
      deviceId: s.deviceId ?? deviceId,
      label: track.label || 'Audio input',
      check: {
        requested: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        actual,
        verified: problems.length === 0,
        problems,
      },
    }
  }

  get isOpen(): boolean {
    return this.track !== null && this.track.readyState === 'live'
  }

  get currentDeviceId(): string | null {
    return this.track?.getSettings().deviceId ?? null
  }

  async close(): Promise<void> {
    this.stopListening()
    if (this.track) {
      this.track.onended = null
      this.track.stop()
    }
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.track = null
  }

  private startListening(): void {
    if (this.track) {
      this.onTrackEnded = () => this.onEvent?.({ type: 'device-lost' })
      this.track.onended = this.onTrackEnded
    }
    if (navigator.mediaDevices?.addEventListener && !this.boundOnDeviceChange) {
      this.boundOnDeviceChange = () => {
        void this.devices().then((devices) => this.onEvent?.({ type: 'devices-changed', devices }))
      }
      navigator.mediaDevices.addEventListener('devicechange', this.boundOnDeviceChange)
    }
  }

  private stopListening(): void {
    if (this.boundOnDeviceChange && navigator.mediaDevices?.removeEventListener) {
      navigator.mediaDevices.removeEventListener('devicechange', this.boundOnDeviceChange)
    }
    this.boundOnDeviceChange = null
    this.onTrackEnded = null
  }
}
