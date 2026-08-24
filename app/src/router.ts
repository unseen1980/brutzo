import { useEffect, useState } from 'react'

export type Route = 'home' | 'wizard' | 'tuner' | 'tone' | 'harness'
const ROUTES: Route[] = ['home', 'wizard', 'tuner', 'tone', 'harness']

export function routeFromHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '').split(/[/?]/)[0] as Route
  return ROUTES.includes(raw) ? raw : 'home'
}

/**
 * Minimal hash router. GitHub Pages cannot rewrite URLs for a SPA, so the app
 * uses #/routes — boring, dependency-free, and works from any static host.
 */
export function useHashRoute(): [Route, (to: Route) => void] {
  const [route, setRoute] = useState<Route>(() => routeFromHash(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(routeFromHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const navigate = (to: Route) => {
    window.location.hash = `#/${to}`
  }
  return [route, navigate]
}
