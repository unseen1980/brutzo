import { useEffect, useRef, useState } from 'react'
import { audioErrorMessage } from '../audio/errors'
import { getEngine, type LatencyInfo } from '../audio/engine'
import { DEFAULT_FX_PARAMS, type FxParams } from '../audio/fx'
import { latencySummary, savedLatency, type SavedLatencyMeasurement } from '../audio/latency'
import { createTakeMetadata, encodeMonoWav, safeTakeFilename, type StoredTake } from '../audio/recorder'
import {
  deleteTake,
  listTakes,
  loadLatencyMeasurement,
  loadProfile,
  saveLatencyMeasurement,
  saveTake,
  type CalibrationProfile,
} from '../audio/storage'
import {
  DEFAULT_TONE_PRESET,
  ToneMonitor,
  TONE_PRESETS,
  type ToneParams,
  type TonePresetName,
} from '../audio/tone'
import { Card, StatusRow } from '../ui/components'
import { currentToneResourceUrls } from '../ui/urls'

type MonitorStatus = 'idle' | 'starting' | 'monitoring' | 'error'

export function Tone() {
  const engine = getEngine()
  const monitorRef = useRef<ToneMonitor | null>(null)
  const nodeRef = useRef<AudioWorkletNode | null>(null)
  const openedHere = useRef(false)
  const mountedRef = useRef(true)
  const startupGeneration = useRef(0)
  const startupPending = useRef(false)
  const [profile, setProfile] = useState<CalibrationProfile | null | undefined>(undefined)
  const [status, setStatus] = useState<MonitorStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [processingWarning, setProcessingWarning] = useState<string | null>(null)
  const [storageWarning, setStorageWarning] = useState<string | null>(null)
  const [preset, setPreset] = useState<TonePresetName>('clean')
  const [params, setParams] = useState<ToneParams>(DEFAULT_TONE_PRESET)
  const [fx, setFx] = useState<FxParams>(DEFAULT_FX_PARAMS)
  const [latency, setLatency] = useState<LatencyInfo | null>(null)
  const [savedLatencyInfo, setSavedLatencyInfo] = useState<SavedLatencyMeasurement | null>(null)
  const [takes, setTakes] = useState<StoredTake[]>([])
  const [takeName, setTakeName] = useState('')
  const [recording, setRecording] = useState(false)
  const [takeBusy, setTakeBusy] = useState(false)

  const reloadTakes = async () => setTakes(await listTakes())

  useEffect(() => {
    let active = true
    void Promise.allSettled([loadProfile(), loadLatencyMeasurement(), listTakes()]).then(
      ([loadedProfile, loadedLatency, loadedTakes]) => {
        if (!active) return
        setProfile(loadedProfile.status === 'fulfilled' ? loadedProfile.value : null)
        setSavedLatencyInfo(loadedLatency.status === 'fulfilled' ? loadedLatency.value : null)
        setTakes(loadedTakes.status === 'fulfilled' ? loadedTakes.value : [])
        if (loadedTakes.status === 'rejected') setError(audioErrorMessage(loadedTakes.reason))
      },
    )
    return () => {
      active = false
    }
  }, [])

  const detach = async () => {
    const graph = engine.audioGraph
    if (graph && nodeRef.current) graph.disconnectSelectedOutput(nodeRef.current)
    monitorRef.current?.dispose()
    monitorRef.current = null
    nodeRef.current = null
    setRecording(false)
    if (openedHere.current) {
      await engine.closeLiveInput()
      openedHere.current = false
    }
  }

  const stop = async () => {
    startupGeneration.current++
    await detach()
    if (mountedRef.current) setStatus('idle')
  }

  useEffect(() => {
    mountedRef.current = true
    const previousInputHandler = engine.input.onEvent
    const inputHandler = (event: Parameters<NonNullable<typeof engine.input.onEvent>>[0]) => {
      previousInputHandler?.(event)
      if (event.type !== 'device-lost' || !mountedRef.current) return
      startupGeneration.current++
      startupPending.current = false
      const graph = engine.audioGraph
      if (graph && nodeRef.current) graph.disconnectSelectedOutput(nodeRef.current)
      monitorRef.current?.dispose()
      monitorRef.current = null
      nodeRef.current = null
      openedHere.current = false
      setRecording(false)
      setStatus('error')
      setError('The audio input was disconnected. Reconnect it, run setup if needed, then start monitoring again.')
      void engine.closeLiveInput()
    }
    engine.input.onEvent = inputHandler
    return () => {
      mountedRef.current = false
      startupGeneration.current++
      const wasStarting = startupPending.current
      startupPending.current = false
      const graph = engine.audioGraph
      if (graph && nodeRef.current) graph.disconnectSelectedOutput(nodeRef.current)
      monitorRef.current?.dispose()
      if (openedHere.current || wasStarting) void engine.closeLiveInput()
      if (engine.input.onEvent === inputHandler) engine.input.onEvent = previousInputHandler
    }
  }, [engine])

  const start = async () => {
    setError(null)
    setProcessingWarning(null)
    setStorageWarning(null)
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(
        audioErrorMessage(new Error('Audio input unavailable'), {
          secure: window.isSecureContext,
          mediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
        }),
      )
      setStatus('error')
      return
    }
    if (!profile) {
      setError('Run the setup wizard before live monitoring so Brutzo can use a verified input and channel.')
      setStatus('error')
      return
    }
    if (profile.demoMode) {
      setError('Built-in microphone demo mode is detection-only. Select a USB amp or interface in setup before live monitoring.')
      setStatus('error')
      return
    }
    if (startupPending.current) return
    startupPending.current = true
    const generation = ++startupGeneration.current
    setStatus('starting')
    const monitor = new ToneMonitor(engine.ensureContext())
    try {
      const resources = currentToneResourceUrls()
      const node = await monitor.initialize(resources.processor, resources.wasm)
      if (!mountedRef.current || generation !== startupGeneration.current) {
        monitor.dispose()
        return
      }
      monitorRef.current = monitor
      nodeRef.current = node
      monitor.setParams(params)
      monitor.setFxParams(fx)
      const opened = await engine.openLiveInput(profile.deviceId)
      if (!mountedRef.current || generation !== startupGeneration.current) {
        monitor.dispose()
        await engine.closeLiveInput()
        return
      }
      openedHere.current = true
      if (!opened.check.verified) setProcessingWarning(opened.check.problems.join('; '))
      engine.audioGraph?.setSelectedChannel(profile.channel)
      engine.audioGraph?.connectSelectedOutput(node)
      monitor.connectOutput()
      setStatus('monitoring')
      const currentLatency = await engine.latencyInfo()
      if (!mountedRef.current || generation !== startupGeneration.current) return
      const saved = savedLatency(currentLatency, opened.label)
      setLatency(currentLatency)
      setSavedLatencyInfo(saved)
      try {
        await saveLatencyMeasurement(saved)
      } catch {
        if (mountedRef.current && generation === startupGeneration.current) {
          setStorageWarning('The latency estimate could not be saved locally. Monitoring still works for this session.')
        }
      }
    } catch (cause) {
      if (!mountedRef.current || generation !== startupGeneration.current) {
        monitor.dispose()
        return
      }
      await detach()
      setError(audioErrorMessage(cause))
      setStatus('error')
    } finally {
      if (generation === startupGeneration.current) startupPending.current = false
    }
  }

  const choosePreset = (name: TonePresetName) => {
    const next = TONE_PRESETS[name]
    setPreset(name)
    setParams(next)
    monitorRef.current?.setParams(next)
  }

  const updateParam = (key: keyof ToneParams, value: number) => {
    const next = { ...params, [key]: value }
    setParams(next)
    monitorRef.current?.setParams(next)
  }

  const updateFx = (patch: Partial<FxParams>) => {
    const next = { ...fx, ...patch }
    setFx(next)
    monitorRef.current?.setFxParams(next)
  }

  const startTake = () => {
    setError(null)
    try {
      if (!monitorRef.current) throw new Error('Start monitoring before recording a take.')
      monitorRef.current.startRecording()
      setRecording(true)
    } catch (cause) {
      setError(audioErrorMessage(cause))
    }
  }

  const stopTake = async () => {
    const monitor = monitorRef.current
    if (!monitor) return
    setTakeBusy(true)
    try {
      const result = await monitor.stopRecording()
      if (result.droppedFrames > 0) throw new Error(`Recorder dropped ${result.droppedFrames} audio frames; the take was not saved.`)
      const createdAt = Date.now()
      const id = globalThis.crypto?.randomUUID?.() ?? `take-${createdAt}`
      const metadata = createTakeMetadata({
        id,
        name: takeName,
        createdAt,
        frames: result.frames,
        sampleRate: result.sampleRate,
        preset,
        tone: params,
        fx,
        latencyMs: latency?.browserEstimateMs ?? null,
        deviceLabel: profile?.deviceLabel ?? 'Default audio input',
      })
      const wav = encodeMonoWav(result.chunks, result.sampleRate)
      await saveTake({ ...metadata, wav: new Blob([wav], { type: 'audio/wav' }) })
      setTakeName('')
      await reloadTakes()
    } catch (cause) {
      setError(audioErrorMessage(cause))
    } finally {
      setRecording(false)
      setTakeBusy(false)
    }
  }

  const removeTake = async (id: string) => {
    try {
      await deleteTake(id)
      await reloadTakes()
    } catch (cause) {
      setError(audioErrorMessage(cause))
    }
  }

  const summary = latencySummary(latency, savedLatencyInfo)
  const monitoring = status === 'monitoring'

  return (
    <>
      <Card title="Tone" sub="Amp, cabinet, FX, latency and processed takes — all on this device.">
        <div className="warn-box">
          Use wired headphones and turn the hardware monitor down before starting. Brutzo is silent until you opt in.
        </div>
        {error && <div className="err-box" role="alert">{error}</div>}
        {processingWarning && (
          <div className="warn-box" role="alert">
            Browser processing could not be disabled: {processingWarning}. Run setup again in Chrome or Edge.
          </div>
        )}
        {storageWarning && <div className="warn-box" role="status">{storageWarning}</div>}
        <StatusRow
          label="Tone engine"
          value={monitoring ? 'Rust→WASM AudioWorklet · live' : status}
          state={monitoring ? 'ok' : status === 'error' ? 'err' : status === 'starting' ? 'warn' : 'off'}
        />
        <StatusRow
          label="Output safety"
          value={fx.muted ? 'muted' : monitoring ? 'audible' : 'off'}
          state={fx.muted ? 'warn' : monitoring ? 'ok' : 'off'}
        />
        <div className="tone-actions">
          {monitoring ? (
            <button className="btn secondary" disabled={recording || takeBusy} onClick={() => void stop()}>Stop monitoring</button>
          ) : (
            <button className="btn" disabled={status === 'starting' || profile === undefined} onClick={() => void start()}>
              {profile === undefined ? 'Loading setup…' : status === 'starting' ? 'Starting tone engine…' : 'Start with wired headphones'}
            </button>
          )}
          <button
            className={`btn ${fx.muted ? '' : 'secondary'}`}
            disabled={!monitoring}
            onClick={() => updateFx({ muted: !fx.muted })}
          >
            {fx.muted ? 'Unmute output' : 'Mute now'}
          </button>
          {(profile === null || profile?.demoMode) && <a className="btn secondary" href="#/wizard">{profile?.demoMode ? 'Choose a USB input' : 'Run setup first'}</a>}
        </div>
      </Card>

      <Card title="Amp & cabinet" sub="Three complete voicings, with stable controls for your own sound.">
        <div className="preset-row">
          {(Object.keys(TONE_PRESETS) as TonePresetName[]).map((name) => (
            <button className={`btn small ${preset === name ? '' : 'secondary'}`} key={name} onClick={() => choosePreset(name)}>
              {name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </div>
        <ToneSlider label="Input" value={params.inputTrimDb} min={-18} max={12} step={0.5} suffix=" dB" onChange={(value) => updateParam('inputTrimDb', value)} />
        <ToneSlider label="Drive" value={params.drive} min={1} max={12} step={0.1} onChange={(value) => updateParam('drive', value)} />
        <ToneSlider label="Tone" value={params.tone} min={0} max={1} step={0.01} onChange={(value) => updateParam('tone', value)} />
        <ToneSlider label="Cabinet" value={params.cabinet} min={0} max={1} step={0.01} onChange={(value) => updateParam('cabinet', value)} />
        <ToneSlider label="Level" value={params.level} min={0} max={1} step={0.01} onChange={(value) => updateParam('level', value)} />
      </Card>

      <Card title="FX" sub="Gate is protective by default. Slap and ambience are opt-in.">
        <EffectToggle label="Noise gate" checked={fx.gateEnabled} onChange={(checked) => updateFx({ gateEnabled: checked })} />
        <ToneSlider label="Gate" value={fx.gateThresholdDb} min={-72} max={-24} step={1} suffix=" dB" disabled={!fx.gateEnabled} onChange={(value) => updateFx({ gateThresholdDb: value })} />
        <EffectToggle label="Slap delay" checked={fx.slapEnabled} onChange={(checked) => updateFx({ slapEnabled: checked, slapMix: checked ? Math.max(fx.slapMix, 0.16) : 0 })} />
        <ToneSlider label="Delay" value={fx.slapTimeMs} min={50} max={180} step={1} suffix=" ms" disabled={!fx.slapEnabled} onChange={(value) => updateFx({ slapTimeMs: value })} />
        <ToneSlider label="Slap mix" value={fx.slapMix} min={0} max={0.4} step={0.01} disabled={!fx.slapEnabled} onChange={(value) => updateFx({ slapMix: value })} />
        <EffectToggle label="Ambience" checked={fx.ambienceEnabled} onChange={(checked) => updateFx({ ambienceEnabled: checked, ambienceMix: checked ? Math.max(fx.ambienceMix, 0.12) : 0 })} />
        <ToneSlider label="Room mix" value={fx.ambienceMix} min={0} max={0.35} step={0.01} disabled={!fx.ambienceEnabled} onChange={(value) => updateFx({ ambienceMix: value })} />
      </Card>

      <Card title="Latency" sub="Browser estimates are shown honestly; a physical loopback test is still required for measured RTT.">
        <StatusRow
          label="Current browser estimate"
          value={summary.currentMs === null ? 'available after monitoring starts' : `${summary.currentMs.toFixed(1)} ms`}
          state={summary.grade === 'good' ? 'ok' : summary.grade === 'high' ? 'warn' : 'off'}
        />
        <StatusRow
          label="Saved setup estimate"
          value={summary.savedMs === null ? 'none saved' : `${summary.savedMs.toFixed(1)} ms · ${summary.deviceLabel || 'audio device'}`}
          state={summary.savedMs === null ? 'off' : summary.savedMs <= 30 ? 'ok' : 'warn'}
        />
        {savedLatencyInfo && (
          <StatusRow
            label="Saved"
            value={new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(savedLatencyInfo.measuredAt)}
            state="off"
          />
        )}
        {profile?.timingOffsetMs != null && (
          <StatusRow
            label="Player timing offset"
            value={`${profile.timingOffsetMs >= 0 ? '+' : ''}${profile.timingOffsetMs.toFixed(0)} ms vs beat · not audio RTT`}
            state="off"
          />
        )}
        {summary.warning && <div className="err-box" role="alert">{summary.warning}</div>}
      </Card>

      <Card title="Processed takes" sub="Records the final amp, cabinet and FX output as a local WAV. Nothing is uploaded.">
        <label className="field-label" htmlFor="take-name">Take name</label>
        <input
          id="take-name"
          className="brutzo-input"
          maxLength={100}
          value={takeName}
          onChange={(event) => setTakeName(event.currentTarget.value)}
          placeholder="First riff"
          disabled={recording || takeBusy}
        />
        <div className="tone-actions">
          {!recording ? (
            <button className="btn" disabled={!monitoring || takeBusy} onClick={startTake}>Record processed output</button>
          ) : (
            <button className="btn" disabled={takeBusy} onClick={() => void stopTake()}>{takeBusy ? 'Saving WAV…' : 'Stop & save take'}</button>
          )}
          {!monitoring && <span className="inline-note">Start monitoring before recording.</span>}
          {recording && <span className="recording-live" role="status">● Recording</span>}
        </div>
        {takes.length === 0 ? (
          <p className="empty-note">No takes yet. Your first processed WAV will appear here.</p>
        ) : (
          <div className="take-list">
            {takes.map((take) => <TakeRow key={take.id} take={take} onDelete={() => void removeTake(take.id)} />)}
          </div>
        )}
      </Card>

      <Card title="Signal path">
        <p className="mono signal-path">
          selected input → input trim → 70 Hz HPF → gate → amp drive → post tone → cabinet FIR → compressor → slap/ambience → 0.5 headroom → safety mute → output + WAV tap
        </p>
      </Card>
    </>
  )
}

function EffectToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="effect-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      <span>{label}</span>
      <strong>{checked ? 'ON' : 'BYPASS'}</strong>
    </label>
  )
}

function ToneSlider({
  label,
  value,
  min,
  max,
  step,
  suffix = '',
  disabled = false,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <label className="tone-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
      <span className="mono">{value.toFixed(step >= 1 ? 0 : 2)}{suffix}</span>
    </label>
  )
}

function TakeRow({ take, onDelete }: { take: StoredTake; onDelete: () => void }) {
  const [url, setUrl] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    const objectUrl = URL.createObjectURL(take.wav)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [take.wav])

  return (
    <article className="take-row">
      <div className="take-copy">
        <strong>{take.name}</strong>
        <span>
          {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(take.createdAt)} · {(take.durationMs / 1000).toFixed(1)} s · {take.preset}
        </span>
      </div>
      <audio controls preload="none" src={url} />
      <div className="take-actions">
        <a className="btn small secondary" href={url} download={safeTakeFilename(take.name)}>Download WAV</a>
        <button
          className="btn small secondary"
          onClick={() => {
            if (confirmDelete) onDelete()
            else setConfirmDelete(true)
          }}
          onBlur={() => setConfirmDelete(false)}
        >
          {confirmDelete ? 'Confirm delete' : 'Delete'}
        </button>
      </div>
    </article>
  )
}
