import { useEffect, useRef, useState } from 'react'
import { getEngine } from '../audio/engine'
import { freqToNearestNote, nearestString, GUITAR_OPEN_STRINGS } from '../audio/notes'
import { loadProfile, type CalibrationProfile } from '../audio/storage'
import { Card, LevelMeter } from '../ui/components'
import { COLORS } from '../ui/tokens'

interface TunerDisplay {
  note: string
  cents: number
  freq: number
  probability: number
}

const IN_TUNE_CENTS = 5

export function Tuner() {
  const engine = getEngine()
  const [status, setStatus] = useState<'idle' | 'starting' | 'listening' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [display, setDisplay] = useState<TunerDisplay | null>(null)
  const [db, setDb] = useState(-100)
  const [clip, setClip] = useState(false)
  const [profile, setProfile] = useState<CalibrationProfile | null>(null)
  const openedHere = useRef(false)

  useEffect(() => {
    let alive = true
    void loadProfile().then((p) => {
      if (alive) setProfile(p)
    })
    return () => {
      alive = false
    }
  }, [])

  const openInput = async () => {
    // Reuse the calibrated device when possible; fall back to the default.
    try {
      await engine.openLiveInput(profile?.deviceId ?? null)
    } catch (e) {
      if (profile?.deviceId && e instanceof Error && e.name === 'OverconstrainedError') {
        await engine.openLiveInput(null)
      } else {
        throw e
      }
    }
    openedHere.current = true
    if (profile) engine.audioGraph?.setSelectedChannel(profile.channel)
  }

  const start = async () => {
    setError(null)
    setStatus('starting')
    try {
      await openInput()
      setStatus('listening')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  const stop = async () => {
    if (openedHere.current) {
      await engine.closeLiveInput()
      openedHere.current = false
    }
    setStatus('idle')
    setDisplay(null)
  }

  // Close the input when leaving the screen, but only if we opened it here.
  useEffect(() => {
    return () => {
      if (openedHere.current) void engine.closeLiveInput()
    }
  }, [engine])

  useEffect(() => {
    if (status !== 'listening') return
    const graph = engine.audioGraph
    if (!graph) return
    let raf = 0
    let smoothCents: number | null = null
    let smoothFreq: number | null = null
    const loop = () => {
      const frame = graph.readFrame()
      setDb(frame.db)
      setClip(frame.clipped)
      const p = frame.pitch
      if (p && p.probability > 0.6) {
        const { note, cents } = freqToNearestNote(p.freq)
        smoothCents = smoothCents === null ? cents : smoothCents * 0.7 + cents * 0.3
        smoothFreq = smoothFreq === null ? p.freq : smoothFreq * 0.7 + p.freq * 0.3
        setDisplay({ note, cents: smoothCents, freq: smoothFreq, probability: p.probability })
      } else {
        smoothCents = null
        smoothFreq = null
        setDisplay(null)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [status, engine])

  const inTune = display !== null && Math.abs(display.cents) <= IN_TUNE_CENTS
  const activeString = display ? nearestString(display.freq) : null
  const centsPct = display ? Math.max(0, Math.min(100, (display.cents + 50) / 2)) : 50

  return (
    <>
      <Card
        title="Tuner"
        sub={
          profile
            ? `Using the calibrated profile: ${profile.deviceLabel || 'default input'} · ${
                profile.channel === 0 ? 'left' : 'right'
              } channel`
            : 'No calibration profile yet — the wizard creates one in two minutes.'
        }
      >
        {error && <div className="err-box">{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0 8px' }}>
          <div className="mono" style={{ fontSize: 15, color: 'var(--b-color-textDim)', minHeight: 22 }}>
            {display
              ? `${display.freq.toFixed(1)} Hz · confidence ${(display.probability * 100).toFixed(0)}%`
              : '—'}
          </div>
          <div
            style={{
              fontFamily: 'var(--b-font-display)',
              fontWeight: 900,
              fontSize: 128,
              lineHeight: 1.1,
              letterSpacing: '0.02em',
              color: display ? (inTune ? COLORS.ok : COLORS.text) : 'var(--b-color-bg3)',
              textShadow: display
                ? `0 0 ${inTune ? 48 : 20}px ${inTune ? 'rgba(79,212,138,.45)' : 'rgba(255,176,32,.25)'}`
                : 'none',
              transition: 'color .15s',
            }}
          >
            {display ? display.note : '–'}
          </div>
          <div
            style={{
              fontFamily: 'var(--b-font-display)',
              fontWeight: 700,
              fontSize: 16,
              letterSpacing: '0.14em',
              color: inTune ? COLORS.ok : 'var(--b-color-textDim)',
              minHeight: 24,
            }}
          >
            {display
              ? inTune
                ? 'IN TUNE'
                : `${display.cents > 0 ? '+' : ''}${display.cents.toFixed(0)} cents ${
                    display.cents > 0 ? 'sharp' : 'flat'
                  }`
              : ''}
          </div>

          {/* cents needle: −50 … +50 */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 460,
              height: 14,
              margin: '18px 0 6px',
              background: 'var(--b-color-bg2)',
              border: '1px solid var(--b-color-line)',
              borderRadius: 7,
            }}
          >
            <span className="mono" style={{ position: 'absolute', left: 6, top: -20, fontSize: 11, color: 'var(--b-color-textDim)' }}>♭ −50</span>
            <span className="mono" style={{ position: 'absolute', right: 6, top: -20, fontSize: 11, color: 'var(--b-color-textDim)' }}>+50 ♯</span>
            <div style={{ position: 'absolute', left: '45%', width: '10%', top: 0, bottom: 0, background: 'rgba(79,212,138,.18)' }} />
            <div style={{ position: 'absolute', left: 'calc(50% - 1px)', top: -3, bottom: -3, width: 2, background: 'var(--b-color-textMid)' }} />
            <div
              style={{
                position: 'absolute',
                left: `calc(${centsPct}% - 2px)`,
                top: -4,
                bottom: -4,
                width: 4,
                borderRadius: 2,
                background: inTune ? COLORS.ok : COLORS.accent,
                boxShadow: `0 0 12px ${inTune ? 'rgba(79,212,138,.7)' : 'rgba(255,176,32,.6)'}`,
                transition: 'left 80ms linear, background .15s',
              }}
            />
          </div>
        </div>

        {/* six-string indicators */}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {GUITAR_OPEN_STRINGS.map((s) => {
            const active = activeString?.midi === s.midi
            const tuned = active && inTune
            return (
              <div
                key={s.note}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '10px 0',
                  borderRadius: 'var(--b-radius-sm)',
                  border: `1px solid ${active ? (tuned ? 'rgba(79,212,138,.6)' : 'rgba(255,176,32,.6)') : 'var(--b-color-line)'}`,
                  background: active ? (tuned ? 'rgba(79,212,138,.08)' : 'rgba(255,176,32,.08)') : 'transparent',
                  color: active ? (tuned ? COLORS.ok : COLORS.accent) : 'var(--b-color-textDim)',
                  fontWeight: 600,
                  fontSize: 15,
                }}
                title={`String ${s.label}: ${s.freq.toFixed(2)} Hz`}
              >
                {s.note}
                <span style={{ display: 'block', fontSize: 11, fontWeight: 400 }}>string {s.label}</span>
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: 16 }}>
          <LevelMeter db={db} clip={clip} />
        </div>

        <p style={{ display: 'flex', gap: 10, marginTop: 18, marginBottom: 0 }}>
          {status === 'listening' ? (
            <button className="btn secondary" onClick={() => void stop()}>
              Stop
            </button>
          ) : (
            <button className="btn" onClick={() => void start()} disabled={status === 'starting'}>
              {status === 'starting' ? 'Opening input…' : 'Start tuning'}
            </button>
          )}
          {!profile && (
            <a className="btn secondary" href="#/wizard">
              Run the setup wizard first
            </a>
          )}
        </p>
      </Card>

      <Card title="Tips">
        <p style={{ color: 'var(--b-color-textMid)', margin: 0 }}>
          Pluck the string, let it ring, and tune at its natural volume — heavy attacks sharpen the
          pitch. The needle smooths over ~150 ms, so trust the hold, not the wobble. Accurate down
          to low E (82 Hz).
        </p>
      </Card>
    </>
  )
}
