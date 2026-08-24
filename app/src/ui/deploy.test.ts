import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const deployWorkflow = readFileSync(
  fileURLToPath(new URL('../../../.github/workflows/deploy.yml', import.meta.url)),
  'utf8',
)

describe('Pages deployment artifact', () => {
  it('publishes and verifies the approved root logo asset', () => {
    expect(deployWorkflow).toContain('cp index.html README.md logo-mark.svg _site/')
    expect(deployWorkflow).toContain('test -s _site/logo-mark.svg')
  })
})
