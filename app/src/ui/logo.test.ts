import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const components = readFileSync(fileURLToPath(new URL('./components.tsx', import.meta.url)), 'utf8')
const css = readFileSync(fileURLToPath(new URL('./global.css', import.meta.url)), 'utf8')

describe('header logo styling', () => {
  it('uses the approved circular mark without the old amp class', () => {
    expect(components).not.toContain('className="amp"')
    expect(css).toContain('.shell-logo img {')
    expect(css).toContain('width: 26px;')
    expect(css).toContain('height: 26px;')
    expect(css).toContain('border-radius: 999px;')
    expect(css).toContain('border: 1.5px dashed rgba(255, 176, 32, 0.7);')
  })
})
