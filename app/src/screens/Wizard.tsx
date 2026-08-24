import { useEffect, useRef, useState } from 'react'
import { getEngine, type LatencyInfo } from '../audio/engine'
import type { DeviceInfo, ProcessingCheck } from '../audio/input'
import { Metronome } from '../audio/metronome'
import { OnsetTracker } from '../audio/onset'
import { pairOnsetsToClicks } from '../audio/timing'
import { iqr, median } from '../audio/stats'
import { requestPersistentStorage, saveProfile, type CalibrationProfile } from '../audio/storage'
import { Card, Dot, LevelMeter, StatusRow } from '../ui/components'

const STEP_TITLES = ['Input device', 'Signal check', 'Timing calibration', 'Summary'] as const

interface WizardData {
  deviceId: string | null
  deviceLabel: string
  demoMode: boolean
  check: ProcessingCheck | null
  sampleRate: number
  channel: 0 | 1
  inputLevelDb: number | null
  clippingSeen: boolean
  humHz: number | null
  latency: LatencyInfo | null
  timingOffsetMs: number | null
  timingSpreadMs: number | null
  strumOffsets: number[] | null
}

const EMPTY_DATA: WizardData = {
  deviceId: null,
  deviceLabel: '',
  demoMode: false,
  check: null,
  sampleRate: 0,
  channel: 0,
  inputLevelDb: null,
  clippingSeen: false,
  humHz: null,
  latency: null,
  timingOffsetMs: null,
  timingSpreadMs: null,
  strumOffsets: null,
}

type DeviceKind = 'usb' | 'line' | 'builtin' | 'unknown'

function inferDeviceKind(label: string): DeviceKind {
  const l = label.toLowerCase()
  if (/katana|scarlett|spark\s|boss|focusrite|line ?6|helix|stomp|interface|usb|ur2\d|quad|capture|preamp/.test(l))
    return 'usb'
  if (/line[- ]?in|line\/mic/.test(l)) return 'line'
  if (/built[- ]?in|internal|macbook|microphone array|default|realtek|laptop|\bmic\b/.test(l))
    return 'builtin'
  return 'unknown'
}

const KIND_LABEL: Record<DeviceKind, string> = {
  usb: 'USB amp / interface',
  line: 'Line-in',
  builtin: 'Built-in mic — demo mode',
  unknown: 'Audio input',
}

export function Wizard() {
  const [step, setStep] = useState(0)
  const [data, setData] = useState<WizardData>(EMPTY_DATA)
  const [inputLost, setInputLost] = useState(false)

  // Route input-controller events to the wizard (hot-plug / unplug).
  useEffect(() => {
    const engine = getEngine()
    engine.input.onEvent = (event) => {
      if (event.type === 'device-lost') setInputLost(true)
      // devices-changed is consumed by the device step itself.
    }
    return () => {
      engine.input.onEvent = null
    }
  }, [])

  const update = (patch: Partial<WizardData>) => setData((d) => ({ ...d, ...patch }))

  return (
    <>
      <Card title="Setup wizard" sub="Four steps. Everything measured here is saved on this device only.">
        <div className="step-dots" role="progressbar" aria-valuenow={step + 1} aria-valuemax={4}>
          {STEP_TITLES.map((t, i) => (
            <div key={t} className={`step ${i <= step ? 'on' : ''}`} title={t} />
          ))}
        </div>
        {inputLost && step > 0 && (
          <div className="err-box">
            The selected input went away (unplugged?). Reconnect it and start again from step 1.
          </div>
        )}
      </Card>

      {step === 0 && (
        <DeviceStep
          onOpened={(patch) => {
            update(patch)
            setInputLost(false)
            setStep(1)
          }}
        />
      )}
      {step === 1 && (
        <CheckStep
          data={data}
          onDone={(patch) => {
            update(patch)
            setStep(2)
          }}
          onBack={() => setStep(0)}
        />
      )}
      {step === 2 && (
        <TimingStep
          data={data}
          onDone={(patch) => {
            update(patch)
            setStep(3)
          }}
          onBack={() => setStep(1)}
        />
      )}
      {step === 3 && (
        <SummaryStep
          data={data}
          onRestart={() => {
            setData(EMPTY_DATA)
            setStep(0)
          }}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Step 1 — pick the input device                                      */
/* ------------------------------------------------------------------ */

function DeviceStep({ onOpened }: { onOpened: (patch: Partial<WizardData>) => void }) {
  const engine = getEngine()
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [granted, setGranted] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hotplugNote, setHotplugNote] = useState<string | null>(null)

  const refresh = async () => {
    try {
      setDevices(await engine.input.listDevices())
    } catch {
      setError('Could not list audio inputs in this browser.')
    }
  }

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        'This browser or context blocks microphone access. Brutzo needs a secure context: use https:// or localhost (during development, http://localhost:5173/app/).',
      )
      return
    }
    void refresh()
    const previous = engine.input.onEvent
    engine.input.onEvent = (event) => {
      if (event.type === 'devices-changed') {
        setDevices(event.devices)
        setHotplugNote('Input list updated — plug/unplug detected.')
      } else if (event.type === 'device-lost') {
        setHotplugNote('The current input was unplugged.')
      }
    }
    return () => {
      engine.input.onEvent = previous
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const grantAccess = async () => {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        'Microphone API unavailable. Open Brutzo over https:// or on localhost, in Chrome or Edge.',
      )
      return
    }
    try {
      // Opening the default input once makes device labels readable.
      await engine.openLiveInput(null)
      await engine.closeLiveInput()
      setGranted(true)
      await refresh()
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow it in the browser’s site settings (the mic icon in the address bar) and try again.'
          : `Could not open an input: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  const pick = async (device: DeviceInfo) => {
    const kind = inferDeviceKind(device.label)
    const deviceId =
      device.deviceId === 'default' || device.deviceId === 'communications'
        ? null // system default — do not pin
        : device.deviceId
    setOpening(device.deviceId)
    setError(null)
    try {
      const result = await engine.openLiveInput(deviceId)
      const ctx = engine.context!
      onOpened({
        deviceId: result.deviceId,
        deviceLabel: result.label,
        demoMode: kind === 'builtin',
        check: result.check,
        sampleRate: ctx.sampleRate,
        channel: engine.audioGraph!.selectedChannel,
      })
    } catch (e) {
      setError(`Could not open “${device.label}”: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setOpening(null)
    }
  }

  return (
    <Card
      title="1 · Pick your input"
      sub="USB amps and interfaces (Katana, Spark, Scarlett…) give the best results. The built-in laptop mic works as a demo."
    >
      {error && <div className="err-box">{error}</div>}
      {hotplugNote && <div className="ok-box">{hotplugNote}</div>}
      {!granted ? (
        <>
          <p style={{ color: 'var(--b-color-textMid)' }}>
            Brutzo needs microphone access to list your inputs by name. Audio never leaves this
            device — no upload, ever.
          </p>
          <button className="btn" onClick={() => void grantAccess()}>
            Grant microphone access
          </button>
        </>
      ) : (
        <>
          {devices.length === 0 && (
            <p style={{ color: 'var(--b-color-textMid)' }}>No audio inputs found.</p>
          )}
          {devices.map((d) => {
            const kind = inferDeviceKind(d.label)
            return (
              <button
                key={d.deviceId}
                className="btn secondary"
                style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 10 }}
                disabled={opening !== null}
                onClick={() => void pick(d)}
              >
                {opening === d.deviceId ? 'Opening…' : d.label}
                <span style={{ color: 'var(--b-color-textDim)', marginLeft: 10, fontSize: 13 }}>
                  {KIND_LABEL[kind]}
                </span>
              </button>
            )
          })}
          <p style={{ color: 'var(--b-color-textDim)', fontSize: 13, marginBottom: 0 }}>
            Guitarists plug in late: connect or disconnect a device and this list refreshes by
            itself.
          </p>
        </>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Step 2 — live signal check                                          */
/* ------------------------------------------------------------------ */

function CheckStep({
  data,
  onDone,
  onBack,
}: {
  data: WizardData
  onDone: (patch: Partial<WizardData>) => void
  onBack: () => void
}) {
  const engine = getEngine()
  const [db, setDb] = useState<number | null>(null)
  const [clip, setClip] = useState(false)
  const [channels, setChannels] = useState<[number, number]>([-100, -100])
  const [selected, setSelected] = useState<0 | 1>(0)
  const [humHz, setHumHz] = useState<number | null>(null)
  const [clipSeen, setClipSeen] = useState(false)
  const [maxDb, setMaxDb] = useState<number | null>(null)
  const humRef = useRef<number | null>(null)

  useEffect(() => {
    const graph = engine.audioGraph
    if (!graph) return
    let raf = 0
    let ticks = 0
    let clipSeenLocal = false
    let maxDbLocal: number | null = null
    const loop = () => {
      const frame = graph.readFrame({ withPitch: false })
      setDb(frame.db)
      setClip(frame.clipped)
      setChannels(frame.channelDb)
      setSelected(frame.selectedChannel)
      if (frame.clipped && !clipSeenLocal) {
        clipSeenLocal = true
        setClipSeen(true)
      }
      if (maxDbLocal === null || frame.db > maxDbLocal) {
        maxDbLocal = frame.db
        setMaxDb(frame.db)
      }
      // Hum check ~twice a second; sticky once found.
      ticks++
      if (ticks % 35 === 0 && humRef.current === null) {
        const hum = graph.checkHum()
        if (hum) {
          humRef.current = hum.freqHz
          setHumHz(hum.freqHz)
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [engine])

  const verify = data.check

  return (
    <Card
      title="2 · Signal check"
      sub="Let it sit quiet for a few seconds (hum check), then play your loudest chord a few times. Aim peaks into the green zone."
    >
      <LevelMeter db={db} clip={clip} />
      <p style={{ color: 'var(--b-color-textDim)', fontSize: 13 }}>
        Target zone: −18 to −6 dB. Red clip lamp = turn down at the guitar or amp. Still under
        −30 dB while playing = turn up.
      </p>

      <div className="status-row">
        <span className="status-label">
          <Dot state={verify?.verified ? 'ok' : verify ? 'warn' : 'off'} />
          Browser processing off
        </span>
        <span className="status-value">
          {verify?.verified
            ? 'verified — echo cancellation / noise suppression / AGC all off'
            : verify
              ? verify.problems.join('; ')
              : 'not checked'}
        </span>
      </div>
      {!verify?.verified && verify && (
        <div className="warn-box">
          Fix it: use Chrome or Edge (Safari and some browsers keep processing on). Check the
          browser’s site settings → microphone, and the OS mic settings (macOS: Sound → Input;
          Windows: mic properties). Then reopen the input from step 1.
        </div>
      )}
      <div className="status-row">
        <span className="status-label">
          <Dot state={clipSeen ? 'err' : 'ok'} />
          Clipping
        </span>
        <span className="status-value">
          {clipSeen ? 'clipped peaks seen — turn down and play again' : 'no flat-topped peaks so far'}
        </span>
      </div>
      <div className="status-row">
        <span className="status-label">
          <Dot state={humHz ? 'warn' : 'ok'} />
          Mains hum (50/60 Hz)
        </span>
        <span className="status-value">
          {humHz
            ? `${humHz} Hz hum detected — try another USB port/cable, or the amp’s ground lift`
            : 'none detected'}
        </span>
      </div>
      <div className="status-row">
        <span className="status-label">
          <Dot state="ok" />
          Channels L / R
        </span>
        <span className="status-value">
          {channels[0].toFixed(0)} / {channels[1].toFixed(0)} dB — auto-selected{' '}
          {selected === 0 ? 'left' : 'right'}
        </span>
      </div>
      <div className="status-row">
        <span className="status-label">
          <Dot state="off" />
          Loudest playing level
        </span>
        <span className="status-value">{maxDb === null ? '—' : `${maxDb.toFixed(1)} dB`}</span>
      </div>
      {data.demoMode && (
        <div className="warn-box">
          Demo mode: the built-in mic hears the room, not your amp’s line signal. Tuning works;
          timing calibration needs headphones.
        </div>
      )}

      <p style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button className="btn secondary" onClick={onBack}>
          Back
        </button>
        <button
          className="btn"
          onClick={() =>
            onDone({
              channel: selected,
              inputLevelDb: maxDb,
              clippingSeen: clipSeen,
              humHz: humRef.current,
            })
          }
        >
          Continue
        </button>
      </p>
    </Card>
  )
}


/* ------------------------------------------------------------------ */
/* Step 3 — strum-along timing calibration                             */
/* ------------------------------------------------------------------ */

const STRUM_COUNT = 8
const CAL_BPM = 80

function TimingStep({
  onDone,
  onBack,
}: {
  data: WizardData
  onDone: (patch: Partial<WizardData>) => void
  onBack: () => void
}) {
  const engine = getEngine()
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'failed'>('idle')
  const [strums, setStrums] = useState(0)
  const [result, setResult] = useState<{ offsets: number[]; medianMs: number; spreadMs: number } | null>(
    null,
  )
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => () => stopRef.current?.(), [])

  const start = () => {
    const ctx = engine.ensureContext()
    const graph = engine.audioGraph!
    setPhase('running')
    setStrums(0)
    setResult(null)

    const metronome = new Metronome(ctx)
    // 1.5 s of lead-in, then 8 clicks at 80 BPM.
    const clicks = metronome.scheduleClicks(STRUM_COUNT, CAL_BPM, ctx.currentTime + 1.5)
    const onsets: Array<{ time: number; db: number }> = []
    const tracker = new OnsetTracker()
    let raf = 0
    let finished = false

    const finish = () => {
      if (finished) return
      finished = true
      cancelAnimationFrame(raf)
      stopRef.current = null
      // Pair each click with its closest onset (robust to missed strums,
      // double triggers, and pre-roll noise — see pairOnsetsToClicks).
      const offsets = pairOnsetsToClicks(
        onsets.map((o) => o.time),
        clicks,
        60 / CAL_BPM / 2,
      )
      if (offsets.length >= 4) {
        const med = median(offsets) ?? 0
        const spread = iqr(offsets) ?? 0
        setResult({ offsets, medianMs: med, spreadMs: spread })
        setPhase('done')
      } else {
        setPhase('failed')
      }
    }

    const loop = () => {
      const frame = graph.readFrame({ withPitch: false })
      const onset = tracker.feed(frame)
      if (onset) {
        onsets.push(onset)
        setStrums(onsets.length)
        if (onsets.length >= STRUM_COUNT) {
          finish()
          return
        }
      }
      if (ctx.currentTime > clicks[clicks.length - 1] + 2) {
        finish()
        return
      }
      raf = requestAnimationFrame(loop)
    }
    stopRef.current = finish
    raf = requestAnimationFrame(loop)
  }

  return (
    <Card
      title="3 · Timing calibration"
      sub={`Mute the strings with your fretting hand and strum along with ${STRUM_COUNT} metronome clicks. We measure how your strums land against the beat.`}
    >
      <div className="warn-box">
        Wear <strong>wired</strong> headphones for this step. If the clicks play through open
        speakers, the microphone hears them too and the measurement is meaningless.
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        {Array.from({ length: STRUM_COUNT }, (_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 10,
              borderRadius: 5,
              background: i < strums ? 'var(--b-color-accent)' : 'var(--b-color-bg3)',
              boxShadow: i < strums ? '0 0 10px rgba(255,176,32,.5)' : 'none',
            }}
          />
        ))}
      </div>

      {phase === 'idle' && (
        <button className="btn" onClick={start}>
          Start — {STRUM_COUNT} strums
        </button>
      )}
      {phase === 'running' && (
        <p style={{ color: 'var(--b-color-accent)', fontWeight: 600 }}>Listening… strum on each click.</p>
      )}
      {phase === 'failed' && (
        <>
          <div className="err-box">
            Didn’t hear enough strums ({strums}/{STRUM_COUNT}). Check the input level in step 2 and
            try again.
          </div>
          <button className="btn" onClick={start}>
            Retry
          </button>
        </>
      )}
      {phase === 'done' && result && (
        <>
          <div className="ok-box">
            Median offset {result.medianMs >= 0 ? '+' : ''}
            {result.medianMs.toFixed(0)} ms ({result.medianMs >= 0 ? 'behind' : 'ahead of'} the beat)
            · spread {result.spreadMs.toFixed(0)} ms.
          </div>
          <p className="mono" style={{ color: 'var(--b-color-textDim)', fontSize: 13 }}>
            {result.offsets.map((o) => `${o >= 0 ? '+' : ''}${o.toFixed(0)}`).join('  ')} ms
          </p>
          {result.spreadMs > 60 && (
            <div className="warn-box">
              Your timing is variable (spread &gt; 60 ms). That’s fine — it improves with practice;
              re-run calibration occasionally.
            </div>
          )}
        </>
      )}

      <p style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button className="btn secondary" onClick={onBack}>
          Back
        </button>
        {phase === 'done' && (
          <button
            className="btn"
            onClick={() =>
              onDone({
                timingOffsetMs: result?.medianMs ?? null,
                timingSpreadMs: result?.spreadMs ?? null,
                strumOffsets: result?.offsets ?? null,
              })
            }
          >
            Continue
          </button>
        )}
      </p>
    </Card>
  )
}


/* ------------------------------------------------------------------ */
/* Step 4 — summary + save                                             */
/* ------------------------------------------------------------------ */

function SummaryStep({ data, onRestart }: { data: WizardData; onRestart: () => void }) {
  const engine = getEngine()
  const [latency, setLatency] = useState<LatencyInfo | null>(null)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void engine.latencyInfo().then((info) => {
      if (alive) setLatency(info)
    })
    return () => {
      alive = false
    }
  }, [engine])

  const save = async () => {
    const profile: CalibrationProfile = {
      id: 'calibration',
      version: 1,
      deviceId: data.deviceId,
      deviceLabel: data.deviceLabel,
      demoMode: data.demoMode,
      channel: data.channel,
      sampleRate: data.sampleRate,
      baseLatencyMs: latency?.baseMs ?? null,
      outputLatencyMs: latency?.outputMs ?? null,
      roundTripMs: latency?.browserEstimateMs ?? null,
      processingVerified: data.check?.verified ?? false,
      processingProblems: data.check?.problems ?? [],
      humHz: data.humHz,
      clippingSeen: data.clippingSeen,
      inputLevelDb: data.inputLevelDb,
      timingOffsetMs: data.timingOffsetMs,
      timingSpreadMs: data.timingSpreadMs,
      updatedAt: Date.now(),
    }
    try {
      await saveProfile(profile)
      await requestPersistentStorage()
      setSaved(true)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Card
      title="4 · Summary"
      sub="This is your calibration profile. The tuner reuses it; scoring will subtract the timing offset."
    >
      <StatusRow label="Input" value={data.deviceLabel || '—'} state={data.demoMode ? 'warn' : 'ok'} />
      {data.demoMode && (
        <div className="warn-box">
          Demo mode (built-in mic). For real playing, use a USB amp/interface — the wizard will be
          waiting.
        </div>
      )}
      <StatusRow
        label="Live channel (auto-selected)"
        value={data.channel === 0 ? 'left' : 'right'}
        state="ok"
      />
      <StatusRow label="Sample rate" value={data.sampleRate ? `${(data.sampleRate / 1000).toFixed(1)} kHz` : '—'} state="off" />
      <StatusRow
        label="Browser processing off"
        value={data.check?.verified ? 'verified' : data.check?.problems.join('; ') || 'not checked'}
        state={data.check?.verified ? 'ok' : 'warn'}
      />
      <StatusRow
        label="Mains hum"
        value={data.humHz ? `${data.humHz} Hz detected` : 'none'}
        state={data.humHz ? 'warn' : 'ok'}
      />
      <StatusRow
        label="Clipping during check"
        value={data.clippingSeen ? 'seen — consider lowering input gain' : 'none'}
        state={data.clippingSeen ? 'warn' : 'ok'}
      />
      <StatusRow
        label="Loudest playing level"
        value={data.inputLevelDb === null ? '—' : `${data.inputLevelDb.toFixed(1)} dB`}
        state={
          data.inputLevelDb !== null && data.inputLevelDb > -1
            ? 'err'
            : data.inputLevelDb !== null && data.inputLevelDb >= -18
              ? 'ok'
              : 'off'
        }
      />

      <StatusRow
        label="Browser output-path estimate"
        value={
          latency?.browserEstimateMs != null
            ? `${latency.browserEstimateMs.toFixed(1)} ms (output ${latency.outputMs?.toFixed(1) ?? '—'} + base ${latency.baseMs?.toFixed(1) ?? '—'})`
            : 'measuring…'
        }
        state={latency?.browserEstimateMs == null ? 'off' : latency.browserEstimateMs > 30 ? 'warn' : 'ok'}
      />
      <StatusRow
        label="Timing offset (median strum)"
        value={
          data.timingOffsetMs != null
            ? `${data.timingOffsetMs >= 0 ? '+' : ''}${data.timingOffsetMs.toFixed(0)} ms vs the beat`
            : 'not measured'
        }
        state={data.timingOffsetMs != null ? 'ok' : 'off'}
      />

      {latency?.bluetoothSuspected && (
        <div className="warn-box">
          This output looks like Bluetooth. Bluetooth adds 100–300 ms of latency — unplayable for
          live monitoring. Plug in wired headphones or speakers.
        </div>
      )}
      {latency?.browserEstimateMs != null && latency.browserEstimateMs > 30 && !latency.bluetoothSuspected && (
        <div className="warn-box">
          Browser estimate above 30 ms. Close other audio apps, or try a different output device. A small
          USB audio interface is the reliable fix.
        </div>
      )}
      {data.humHz != null && (
        <div className="warn-box">
          Ground-loop hum: try a different USB port, a different cable, or the ground-lift switch
          on the amp/interface.
        </div>
      )}

      {saveError && <div className="err-box">Could not save the profile: {saveError}</div>}
      {saved ? (
        <div className="ok-box">
          Calibration profile saved to this device. <a href="#/tuner">Open the tuner →</a>
        </div>
      ) : (
        <p style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button className="btn secondary" onClick={onRestart}>
            Start over
          </button>
          <button className="btn" onClick={() => void save()}>
            Save profile
          </button>
        </p>
      )}
    </Card>
  )
}
