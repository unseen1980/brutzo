import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyTokens } from './ui/tokens'
import './ui/global.css'

// Note: no React.StrictMode — its double-invoked effects in dev would open the
// microphone twice. Audio side effects need predictable mount/unmount.
applyTokens(document.documentElement)
createRoot(document.getElementById('root')!).render(<App />)
