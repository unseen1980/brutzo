/**
 * Brutzo design tokens — the single source of truth for the app UI.
 * Canonical visual reference: /design/foundations.html (see CLAUDE.md).
 * These values are injected as CSS custom properties at startup by
 * applyTokens(); CSS must only use var(--b-*) — never hard-code hex values.
 */
export const COLORS = {
  accent: '#FFB020', // stage-light amber
  bg0: '#0A0A0B', // deepest stage black
  bg1: '#121214', // panel
  bg2: '#1C1C21', // raised panel
  bg3: '#26262C', // highest surface
  line: '#3A3A42', // hairline borders
  textDim: '#6E6B67', // warm gray, captions
  textMid: '#A09C96', // warm gray, secondary text
  text: '#F2F1EE', // off-white
  ok: '#4FD48A',
  warn: '#FF6A1F',
  err: '#FF5F52',
  info: '#00D3C0',
} as const

export const FONTS = {
  display: "'Archivo', system-ui, sans-serif",
  body: "'IBM Plex Sans', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
} as const

export const RADIUS = { sm: '8px', md: '12px', lg: '16px' } as const

/** Writes all tokens to the document root as --b-color-*, --b-font-*, --b-radius-*. */
export function applyTokens(root: HTMLElement): void {
  const style = root.style
  for (const [name, value] of Object.entries(COLORS)) style.setProperty(`--b-color-${name}`, value)
  for (const [name, value] of Object.entries(FONTS)) style.setProperty(`--b-font-${name}`, value)
  for (const [name, value] of Object.entries(RADIUS)) style.setProperty(`--b-radius-${name}`, value)
}
