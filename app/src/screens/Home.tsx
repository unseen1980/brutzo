import { useEffect, useState } from 'react'
import { Card } from '../ui/components'
import { loadProfile } from '../audio/storage'

export function Home() {
  const [hasProfile, setHasProfile] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    loadProfile()
      .then((p) => {
        if (alive) setHasProfile(Boolean(p))
      })
      .catch(() => {
        if (alive) setHasProfile(false)
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <>
      <Card title="Brutzo" sub="Phase 0 — Foundation. The Ghost arrives later; today we earn trust with clean signal.">
        <p style={{ color: 'var(--b-color-textMid)', marginTop: 0 }}>
          Plug your guitar into your amp's USB out (Katana, Spark, Scarlett…), put on{' '}
          <strong>wired</strong> headphones, and run the setup wizard once. Everything it measures is
          saved on this device only — audio never leaves it.
        </p>
        <p style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 0 }}>
          <a className="btn" href="#/wizard">
            {hasProfile ? 'Run setup again' : 'Start setup wizard'}
          </a>
          <a className="btn secondary" href="#/tuner">
            Open tuner
          </a>
          <a className="btn secondary" href="#/harness">
            Reference-clip harness
          </a>
        </p>
      </Card>

      <Card title="What's in Phase 0">
        <div className="status-row">
          <span className="status-label">
            <span className="dot ok" />Setup wizard
          </span>
          <span className="status-value">device pick · meters · input checks · timing calibration</span>
        </div>
        <div className="status-row">
          <span className="status-label">
            <span className="dot ok" />Tuner
          </span>
          <span className="status-value">YIN pitch detection · accurate to low E (82 Hz)</span>
        </div>
        <div className="status-row">
          <span className="status-label">
            <span className="dot ok" />Reference-clip harness
          </span>
          <span className="status-value">same audio graph as live input · pass/fail table with cents error</span>
        </div>
        <div className="status-row">
          <span className="status-label">
            <span className="dot off" />Tone engine · the Ghost · accounts
          </span>
          <span className="status-value">Phase 1+ — not in this build</span>
        </div>
      </Card>

      <Card title="Calibration profile">
        <p style={{ color: 'var(--b-color-textMid)', margin: 0 }}>
          {hasProfile === null
            ? 'Checking local storage…'
            : hasProfile
              ? 'A calibration profile is saved on this device (IndexedDB). The tuner reuses its input settings.'
              : 'No calibration profile yet — run the setup wizard to create one.'}
        </p>
      </Card>
    </>
  )
}
