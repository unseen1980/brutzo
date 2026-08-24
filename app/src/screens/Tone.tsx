import { useEffect, useRef, useState } from 'react'
import { getEngine, type LatencyInfo } from '../audio/engine'
import { loadProfile, type CalibrationProfile } from '../audio/storage'
import { DEFAULT_TONE_PRESET, ToneMonitor, TONE_PRESETS, type ToneParams, type TonePresetName } from '../audio/tone'
import { Card, StatusRow } from '../ui/components'
import { currentToneResourceUrls } from '../ui/urls'

export function Tone() {
  const engine = getEngine()
  const monitorRef = useRef<ToneMonitor | null>(null)
  const nodeRef = useRef<AudioWorkletNode | null>(null)
  const openedHere = useRef(false)
  const [profile, setProfile] = useState<CalibrationProfile | null>(null)
  const [status, setStatus] = useState<'idle' | 'starting' | 'monitoring' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [preset, setPreset] = useState<TonePresetName>('clean')
  const [params, setParams] = useState<ToneParams>(DEFAULT_TONE_PRESET)
  const [latency, setLatency] = useState<LatencyInfo | null>(null)

  useEffect(() => { void loadProfile().then(setProfile).catch(() => setProfile(null)) }, [])

  const detach = async () => {
    const graph = engine.audioGraph
    if (graph && nodeRef.current) graph.disconnectSelectedOutput(nodeRef.current)
    monitorRef.current?.dispose()
    monitorRef.current = null
    nodeRef.current = null
    if (openedHere.current) {
      await engine.closeLiveInput()
      openedHere.current = false
    }
  }

  const stop = async () => {
    await detach()
    setStatus('idle')
  }

  useEffect(() => () => {
    const graph = engine.audioGraph
    if (graph && nodeRef.current) graph.disconnectSelectedOutput(nodeRef.current)
    monitorRef.current?.dispose()
    if (openedHere.current) void engine.closeLiveInput()
  }, [engine])

  const start = async () => {
    setError(null)
    setStatus('starting')
    try {
      const ctx = engine.ensureContext()
      const monitor = new ToneMonitor(ctx)
      const resources = currentToneResourceUrls()
      const node = await monitor.initialize(resources.processor, resources.wasm)
      monitorRef.current = monitor
      nodeRef.current = node
      monitor.setParams(params)
      await engine.openLiveInput(profile?.deviceId ?? null)
      openedHere.current = true
      if (profile) engine.audioGraph?.setSelectedChannel(profile.channel)
      engine.audioGraph?.connectSelectedOutput(node)
      monitor.connectOutput()
      setLatency(await engine.latencyInfo())
      setStatus('monitoring')
    } catch (cause) {
      await detach()
      setError(cause instanceof Error ? cause.message : String(cause))
      setStatus('error')
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

  const latencyMs = latency?.roundTripMs ?? latency?.outputMs ?? latency?.baseMs ?? null

  return (
    <>
      <Card title="Tone lab" sub="Phase 1 — the first real-time Rust→WASM amp path. Use wired headphones.">
        <div className="warn-box">Turn your amp/interface monitor down before starting. Brutzo monitoring is off by default to prevent feedback.</div>
        {error && <div className="err-box">{error}</div>}
        <StatusRow label="Tone engine" value={status === 'monitoring' ? 'Rust→WASM AudioWorklet · live' : status} state={status === 'monitoring' ? 'ok' : status === 'error' ? 'err' : status === 'starting' ? 'warn' : 'off'} />
        <StatusRow label="Browser latency estimate" value={latencyMs === null ? 'available after start' : `${latencyMs.toFixed(1)} ms`} state={latencyMs === null ? 'off' : latencyMs <= 30 ? 'ok' : 'warn'} />
        {latency?.bluetoothSuspected && <div className="err-box">Bluetooth output detected or suspected. Switch to wired headphones before monitoring.</div>}

        <p style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(Object.keys(TONE_PRESETS) as TonePresetName[]).map((name) => (
            <button className={`btn small ${preset === name ? '' : 'secondary'}`} key={name} onClick={() => choosePreset(name)}>
              {name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </p>
        <ToneSlider label="Drive" value={params.drive} min={1} max={12} step={0.1} onChange={(v) => updateParam('drive', v)} />
        <ToneSlider label="Tone" value={params.tone} min={0} max={1} step={0.01} onChange={(v) => updateParam('tone', v)} />
        <ToneSlider label="Level" value={params.level} min={0} max={1} step={0.01} onChange={(v) => updateParam('level', v)} />
        <p style={{ display: 'flex', gap: 10, marginBottom: 0 }}>
          {status === 'monitoring' ? (
            <button className="btn secondary" onClick={() => void stop()}>Stop monitoring</button>
          ) : (
            <button className="btn" disabled={status === 'starting'} onClick={() => void start()}>
              {status === 'starting' ? 'Starting tone engine…' : 'Start with wired headphones'}
            </button>
          )}
          {!profile && <a className="btn secondary" href="#/wizard">Run setup first</a>}
        </p>
      </Card>
      <Card title="Signal path">
        <p className="mono" style={{ color: 'var(--b-color-textMid)', margin: 0 }}>
          selected input → 70 Hz HPF → amp drive → tone filter → cab roll-off → safety bound → output
        </p>
        <p style={{ color: 'var(--b-color-textDim)', marginBottom: 0 }}>
          This is the Phase 1 foundation, not the finished amp model. Measured cabinet IRs, FX and recording land next.
        </p>
      </Card>
    </>
  )
}

function ToneSlider({ label, value, min, max, step, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '80px 1fr 52px', gap: 12, alignItems: 'center', margin: '14px 0' }}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
      <span className="mono" style={{ textAlign: 'right', color: 'var(--b-color-textMid)' }}>{value.toFixed(2)}</span>
    </label>
  )
}
