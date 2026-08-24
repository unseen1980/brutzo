import type { ComponentType } from 'react'
import { useHashRoute, type Route } from './router'
import { PageShell } from './ui/components'
import { Home } from './screens/Home'
import { Wizard } from './screens/Wizard'
import { Tuner } from './screens/Tuner'
import { Harness } from './screens/Harness'

const SCREENS: Record<Route, ComponentType> = {
  home: Home,
  wizard: Wizard,
  tuner: Tuner,
  harness: Harness,
}

export function App() {
  const [route, navigate] = useHashRoute()
  const Screen = SCREENS[route]
  return (
    <PageShell route={route} navigate={navigate}>
      <Screen />
    </PageShell>
  )
}
