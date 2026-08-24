import { describe, expect, it } from 'vitest'
import { audioErrorMessage } from './errors'

describe('audio error messages', () => {
  it.each([
    ['NotAllowedError', 'Allow microphone access'],
    ['NotFoundError', 'No audio input'],
    ['NotReadableError', 'already in use'],
    ['AbortError', 'could not start'],
  ])('maps %s to an actionable message', (name, expected) => {
    expect(audioErrorMessage(Object.assign(new Error(), { name }))).toContain(expected)
  })

  it('explains insecure contexts and unsupported browsers', () => {
    expect(audioErrorMessage(new Error('x'), { secure: false, mediaDevices: true })).toContain('https://')
    expect(audioErrorMessage(new Error('x'), { secure: true, mediaDevices: false })).toContain('Chrome or Edge')
  })
})
