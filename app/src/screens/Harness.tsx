import { Card } from '../ui/components'

export function Harness() {
  return (
    <Card title="Reference-clip harness" sub="Arriving in the next milestone of this build.">
      <p style={{ color: 'var(--b-color-textMid)' }}>
        Loads WAV clips plus an expected-pitch manifest and runs them through the same audio graph
        as live input, reporting per-clip cents error.
      </p>
    </Card>
  )
}
