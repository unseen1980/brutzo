import { Card } from '../ui/components'

export function Wizard() {
  return (
    <Card title="Setup wizard" sub="Arriving in the next milestone of this build.">
      <p style={{ color: 'var(--b-color-textMid)' }}>
        The wizard walks through input device selection, level and hum checks, timing calibration,
        and saves a calibration profile.
      </p>
    </Card>
  )
}
