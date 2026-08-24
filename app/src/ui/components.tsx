import type { ReactNode } from 'react'
import { useEffect } from 'react'
import type { Route } from '../router'
import { COLORS } from './tokens'

export function PageShell({
  route,
  navigate,
  children,
}: {
  route: Route
  navigate: (to: Route) => void
  children: ReactNode
}) {
  useEffect(() => {
    document.title = `Brutzo — ${route[0].toUpperCase()}${route.slice(1)}`
  }, [route])

  const links: Array<[Route, string]> = [
    ['home', 'Home'],
    ['wizard', 'Setup wizard'],
    ['tuner', 'Tuner'],
    ['harness', 'Harness'],
  ]

  return (
    <div className="shell">
      <header className="shell-header">
        <a className="shell-logo" href="#/home">
          <span className="amp" />
          BRUTZO
        </a>
        <nav className="shell-nav">
          {links.map(([to, label]) => (
            <a
              key={to}
              href={`#/${to}`}
              className={route === to ? 'active' : ''}
              onClick={() => navigate(to)}
            >
              {label}
            </a>
          ))}
          <a href="/">brutzo.com ↗</a>
        </nav>
      </header>
      <main className="shell-main">{children}</main>
    </div>
  )
}

export function Card({ title, sub, children }: { title?: string; sub?: string; children: ReactNode }) {
  return (
    <section className="card">
      {title && <h2 className="card-title">{title}</h2>}
      {sub && <p className="card-sub">{sub}</p>}
      {children}
    </section>
  )
}

export type DotState = 'ok' | 'warn' | 'err' | 'off'

export function Dot({ state }: { state: DotState }) {
  return <span className={`dot ${state}`} aria-hidden />
}

export function StatusRow({
  label,
  value,
  state,
}: {
  label: string
  value: ReactNode
  state?: DotState
}) {
  return (
    <div className="status-row">
      <span className="status-label">
        {state && <Dot state={state} />}
        {label}
      </span>
      <span className="status-value">{value}</span>
    </div>
  )
}

/** Horizontal level meter with a green target zone, used by the wizard. */
export function LevelMeter({ db, clip }: { db: number | null; clip: boolean }) {
  // Map [-60, 0] dBFS to [0, 100]%
  const pct = db === null ? 0 : Math.max(0, Math.min(100, ((db + 60) / 60) * 100))
  const zoneStart = ((-18 + 60) / 60) * 100
  const zoneEnd = ((-6 + 60) / 60) * 100
  const color =
    clip
      ? COLORS.err
      : db !== null && db > -1.5
        ? COLORS.err
        : db !== null && db >= -18 && db <= -6
          ? COLORS.ok
          : COLORS.accent
  return (
    <div
      style={{
        position: 'relative',
        height: 26,
        background: 'var(--b-color-bg2)',
        border: '1px solid var(--b-color-line)',
        borderRadius: 'var(--b-radius-sm)',
        overflow: 'hidden',
      }}
    >
      {/* target zone: -18 .. -6 dBFS */}
      <div
        style={{
          position: 'absolute',
          left: `${zoneStart}%`,
          width: `${zoneEnd - zoneStart}%`,
          top: 0,
          bottom: 0,
          background: 'rgba(79, 212, 138, 0.12)',
          borderLeft: '1px solid rgba(79, 212, 138, 0.5)',
          borderRight: '1px solid rgba(79, 212, 138, 0.5)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${color}55, ${color})`,
          transition: 'width 60ms linear',
        }}
      />
      <span
        className="mono"
        style={{
          position: 'absolute',
          right: 10,
          top: 3,
          fontSize: 12,
          color: 'var(--b-color-textMid)',
        }}
      >
        {db === null ? '—' : `${db.toFixed(1)} dB`}
      </span>
    </div>
  )
}
