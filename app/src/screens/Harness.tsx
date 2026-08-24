import { useEffect, useState } from 'react'
import { getEngine } from '../audio/engine'
import { DEFAULT_FX_PARAMS } from '../audio/fx'
import { centsBetween } from '../audio/notes'
import { encodeMonoWav } from '../audio/recorder'
import { median } from '../audio/stats'
import { ToneMonitor, TONE_PRESETS, type RecordingResult, type ToneParams } from '../audio/tone'
import { Card, Dot } from '../ui/components'
import { COLORS } from '../ui/tokens'
import { currentHarnessClipsUrl, currentToneResourceUrls } from '../ui/urls'

/** Served beside /app/ in production; the dev server maps it to repo root. */
const CLIPS_URL = currentHarnessClipsUrl()

interface ManifestClip {
  file: string
  expectedHz: number
  expectedNote: string
  toleranceCents: number
  description: string
}

interface Manifest {
  version: number
  description: string
  clips: ManifestClip[]
}

type ClipStatus = 'pending' | 'running' | 'pass' | 'fail' | 'error'

interface ClipResult extends ManifestClip {
  status: ClipStatus
  detectedHz: number | null
  centsError: number | null
  frames: number
  message?: string
}

/** Poll interval while a clip plays through the graph (ms). */
const POLL_MS = 40
/** Minimum YIN confidence for a frame to count toward the verdict. */
const MIN_PROBABILITY = 0.6

export function Harness() {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [results, setResults] = useState<ClipResult[]>([])
  const [running, setRunning] = useState(false)
  const [sampleRate, setSampleRate] = useState<number | null>(null)
  const [toneHarness, setToneHarness] = useState<{ running: boolean; message: string; pass: boolean | null }>({
    running: false,
    message: 'Not run yet.',
    pass: null,
  })

  useEffect(() => {
    let alive = true
    fetch(`${CLIPS_URL}/manifest.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`manifest fetch failed: HTTP ${r.status}`)
        return r.json() as Promise<Manifest>
      })
      .then((m) => {
        if (alive) setManifest(m)
      })
      .catch((e) => {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [])

  const run = async () => {
    if (!manifest || running) return
    setRunError(null)
    const engine = getEngine()
    let ctx: AudioContext
    try {
      ctx = engine.ensureContext()
    } catch (e) {
      setRunError(`Web Audio is unavailable in this browser: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    const graph = engine.audioGraph!
    setSampleRate(ctx.sampleRate)
    setRunning(true)

    const initial: ClipResult[] = manifest.clips.map((c) => ({
      ...c,
      status: 'pending',
      detectedHz: null,
      centsError: null,
      frames: 0,
    }))
    setResults(initial)

    for (let i = 0; i < initial.length; i++) {
      const clip = initial[i]
      setResults((rs) => rs.map((r, j) => (j === i ? { ...r, status: 'running' } : r)))
      try {
        const response = await fetch(`${CLIPS_URL}/${clip.file}`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const buffer = await engine.decodeAudioFile(await response.arrayBuffer())

        // Same graph as live input: buffer source → inputBus → splitter →
        // channel gates → analysers → YIN, polled exactly like the tuner.
        const source = ctx.createBufferSource()
        source.buffer = buffer
        graph.connectSource(source)
        const estimates: number[] = []
        const sourceStartTime = ctx.currentTime
        source.start()
        await new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            const frame = graph.readFrame()
            const p = frame.pitch
            if (p && p.probability >= MIN_PROBABILITY) estimates.push(p.freq)
            if (frame.time > sourceStartTime + buffer.duration + 0.15) {
              clearInterval(timer)
              resolve()
            }
          }, POLL_MS)
        })
        graph.disconnectSource(source)

        const detected = median(estimates)
        if (detected === null || estimates.length < 5) {
          setResults((rs) =>
            rs.map((r, j) =>
              j === i
                ? { ...r, status: 'fail', frames: estimates.length, message: 'no pitch detected' }
                : r,
            ),
          )
          continue
        }
        const cents = centsBetween(detected, clip.expectedHz)
        setResults((rs) =>
          rs.map((r, j) =>
            j === i
              ? {
                  ...r,
                  status: Math.abs(cents) <= clip.toleranceCents ? 'pass' : 'fail',
                  detectedHz: detected,
                  centsError: cents,
                  frames: estimates.length,
                }
              : r,
          ),
        )
      } catch (e) {
        setResults((rs) =>
          rs.map((r, j) =>
            j === i
              ? { ...r, status: 'error', message: e instanceof Error ? e.message : String(e) }
              : r,
          ),
        )
      }
    }
    setRunning(false)
  }

  const runTonePath = async () => {
    if (!manifest || toneHarness.running) return
    setToneHarness({ running: true, message: 'Running the complete tone/FX/recorder path…', pass: null })
    const engine = getEngine()
    const ctx = engine.ensureContext()
    const graph = engine.audioGraph!
    const monitor = new ToneMonitor(ctx)
    let node: AudioWorkletNode | null = null
    try {
      const clip = manifest.clips[0]
      const response = await fetch(`${CLIPS_URL}/${clip.file}`)
      if (!response.ok) throw new Error(`fixture fetch failed: HTTP ${response.status}`)
      const buffer = await engine.decodeAudioFile(await response.arrayBuffer())
      const resources = currentToneResourceUrls()
      node = await monitor.initialize(resources.processor, resources.wasm)
      graph.connectSelectedOutput(node)
      monitor.connectOutput()

      const capture = async (tone: ToneParams, muted: boolean): Promise<RecordingResult> => {
        monitor.setParams(tone)
        monitor.setFxParams({ ...DEFAULT_FX_PARAMS, muted })
        await wait(100)
        const source = ctx.createBufferSource()
        source.buffer = buffer
        graph.connectSource(source)
        try {
          monitor.startRecording()
          await new Promise<void>((resolve) => {
            source.onended = () => resolve()
            source.start()
          })
          await wait(100)
          return await monitor.stopRecording()
        } finally {
          graph.disconnectSource(source)
        }
      }

      const clean = await capture(TONE_PRESETS.clean, false)
      const lead = await capture(TONE_PRESETS.lead, false)
      const muted = await capture(TONE_PRESETS.clean, true)
      const cleanLevel = meanAbsolute(clean)
      const leadLevel = meanAbsolute(lead)
      const mutedLevel = meanAbsolute(muted)
      const peak = Math.max(maxAbsolute(clean), maxAbsolute(lead))
      const wav = encodeMonoWav(clean.chunks, clean.sampleRate)
      const wavHeader = new TextDecoder().decode(new Uint8Array(wav, 0, 4))
      const finite = [...clean.chunks, ...lead.chunks, ...muted.chunks].every((chunk) =>
        chunk.every((sample) => Number.isFinite(sample)),
      )
      const pass =
        clean.frames > 0 &&
        lead.frames > 0 &&
        clean.droppedFrames + lead.droppedFrames + muted.droppedFrames === 0 &&
        finite &&
        peak <= 1 &&
        wavHeader === 'RIFF' &&
        cleanLevel > 0 &&
        Math.abs(leadLevel - cleanLevel) > cleanLevel * 0.03 &&
        mutedLevel < cleanLevel * 0.02
      setToneHarness({
        running: false,
        pass,
        message: `${pass ? 'PASS' : 'FAIL'} · clean ${cleanLevel.toFixed(4)} mean · lead ${leadLevel.toFixed(4)} · peak ${peak.toFixed(4)} · muted ${mutedLevel.toFixed(6)} · dropped ${clean.droppedFrames + lead.droppedFrames + muted.droppedFrames} · WAV ${wav.byteLength} bytes`,
      })
    } catch (error) {
      setToneHarness({ running: false, pass: false, message: error instanceof Error ? error.message : String(error) })
    } finally {
      if (node) graph.disconnectSelectedOutput(node)
      monitor.dispose()
    }
  }

  const passed = results.filter((r) => r.status === 'pass').length
  const finished = results.length > 0 && results.every((r) => r.status !== 'pending' && r.status !== 'running')
  const accuracy = results.length > 0 ? (passed / results.length) * 100 : null

  return (
    <>
      <Card
        title="Reference-clip harness"
        sub="Every clip plays through the exact same node graph as live input — buffer source → channel auto-select → analysers → YIN. If a feature can't run from both paths, the design is wrong."
      >
        {loadError && (
          <div className="err-box">
            Could not load the clip manifest from <code>{CLIPS_URL}/manifest.json</code>: {loadError}
          </div>
        )}
        {runError && <div className="err-box">{runError}</div>}
        {!loadError && !manifest && (
          <p style={{ color: 'var(--b-color-textMid)' }}>Loading manifest…</p>
        )}
        {manifest && (
          <>
            <p style={{ color: 'var(--b-color-textMid)', marginTop: 0 }}>
              {manifest.clips.length} clips · {manifest.description}
            </p>
            <p style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn" onClick={() => void run()} disabled={running}>
                {running ? 'Running…' : 'Run harness'}
              </button>
              {sampleRate !== null && (
                <span className="mono" style={{ color: 'var(--b-color-textDim)', fontSize: 13 }}>
                  context {(sampleRate / 1000).toFixed(1)} kHz
                </span>
              )}
            </p>
          </>
        )}

        {results.length > 0 && (
          <table className="brutzo-table" style={{ marginTop: 14 }}>
            <thead>
              <tr>
                <th>Clip</th>
                <th>Expected</th>
                <th>Detected</th>
                <th>Cents error</th>
                <th>Frames</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.file}>
                  <td className="desc" title={r.description}>
                    {r.expectedNote} <span style={{ color: 'var(--b-color-textDim)' }}>{r.file}</span>
                  </td>
                  <td>{r.expectedHz.toFixed(2)} Hz</td>
                  <td>{r.detectedHz !== null ? `${r.detectedHz.toFixed(2)} Hz` : '—'}</td>
                  <td
                    style={{
                      color:
                        r.centsError === null
                          ? undefined
                          : Math.abs(r.centsError) <= r.toleranceCents
                            ? COLORS.ok
                            : COLORS.err,
                    }}
                  >
                    {r.centsError !== null
                      ? `${r.centsError > 0 ? '+' : ''}${r.centsError.toFixed(1)}`
                      : r.message ?? '—'}
                  </td>
                  <td>{r.frames > 0 ? r.frames : '—'}</td>
                  <td className="note">
                    <Dot
                      state={
                        r.status === 'pass'
                          ? 'ok'
                          : r.status === 'fail' || r.status === 'error'
                            ? 'err'
                            : r.status === 'running'
                              ? 'warn'
                              : 'off'
                      }
                    />
                    {r.status === 'pending'
                      ? 'pending'
                      : r.status === 'running'
                        ? 'running…'
                        : r.status === 'pass'
                          ? 'pass'
                          : r.status === 'fail'
                            ? 'fail'
                            : `error: ${r.message}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {finished && (
          <div className={accuracy !== null && accuracy >= 95 ? 'ok-box' : 'err-box'}>
            <strong>
              {passed}/{results.length} clips passed ({accuracy?.toFixed(0)}%).
            </strong>{' '}
            Phase 0 exit criterion: ≥ 95% note accuracy on the reference-clip library (PLAN.md §7).
            These clips are synthetic; the criterion bites once the real Katana recordings are in.
          </div>
        )}
      </Card>

      <Card
        title="Phase 1 full-path harness"
        sub="Feeds the first reference WAV through channel selection, Rust/WASM amp and cabinet FIR, native FX/headroom, final-output recorder, and WAV encoder."
      >
        <div className="warn-box">This test briefly plays processed audio. Use wired headphones and lower the output first.</div>
        <button className="btn" onClick={() => void runTonePath()} disabled={!manifest || toneHarness.running}>
          {toneHarness.running ? 'Running full path…' : 'Run Phase 1 full path'}
        </button>
        <div className={toneHarness.pass === null ? 'warn-box' : toneHarness.pass ? 'ok-box' : 'err-box'} role="status">
          {toneHarness.message}
        </div>
      </Card>

      <Card title="Adding real clips (your part)">
        <p style={{ color: 'var(--b-color-textMid)', margin: 0 }}>
          Record 3–5 s mono WAVs through the Katana over USB — chromatics, open strings, good /
          flat / wobbly bends, vibrato, chords, mute-scratch, slow Stairway phrases (PLAN.md §11.3)
          — drop them into <code>harness/clips/</code> and add an entry per clip to{' '}
          <code>harness/clips/manifest.json</code> with the expected frequency (toleranceCents: 10
          for steady notes, 25 for bends). The harness table above is the regression record: run it
          before and after any change to the audio path.
        </p>
      </Card>
    </>
  )
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function meanAbsolute(result: RecordingResult): number {
  let sum = 0
  let frames = 0
  for (const chunk of result.chunks) {
    for (let i = 0; i < chunk.length; i++) sum += Math.abs(chunk[i])
    frames += chunk.length
  }
  return frames > 0 ? sum / frames : 0
}

function maxAbsolute(result: RecordingResult): number {
  let peak = 0
  for (const chunk of result.chunks) {
    for (let i = 0; i < chunk.length; i++) peak = Math.max(peak, Math.abs(chunk[i]))
  }
  return peak
}
