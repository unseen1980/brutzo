import { Card } from '../ui/components'

export function Tuner() {
  return (
    <Card title="Tuner" sub="Arriving in the next milestone of this build.">
      <p style={{ color: 'var(--b-color-textMid)' }}>
        Real-time pitch detection (YIN), big note display, cents needle, six-string indicators.
      </p>
    </Card>
  )
}
