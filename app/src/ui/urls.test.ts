import { describe, expect, it } from 'vitest'
import { harnessClipsUrl, logoPreviewUrl, marketingSiteUrl, toneResourceUrls } from './urls'

describe('deployment URLs', () => {
  it.each([
    ['https://unseen1980.github.io/brutzo/app/', 'https://unseen1980.github.io/brutzo/harness/clips'],
    ['https://brutzo.com/app/', 'https://brutzo.com/harness/clips'],
    ['http://localhost:5173/app/', 'http://localhost:5173/harness/clips'],
  ])('resolves harness clips from app base %s', (appBase, expected) => {
    expect(harnessClipsUrl(appBase)).toBe(expected)
  })

  it.each([
    ['https://unseen1980.github.io/brutzo/app/', 'https://unseen1980.github.io/brutzo/'],
    ['https://brutzo.com/app/', 'https://brutzo.com/'],
    ['http://localhost:5173/app/', 'http://localhost:5173/'],
  ])('resolves the marketing site from app base %s', (appBase, expected) => {
    expect(marketingSiteUrl(appBase)).toBe(expected)
  })

  it.each([
    [
      'https://unseen1980.github.io/brutzo/app/',
      'https://unseen1980.github.io/brutzo/app/audio/tone-processor.js',
      'https://unseen1980.github.io/brutzo/app/audio/brutzo_tone_core.wasm',
    ],
    [
      'https://brutzo.com/app/',
      'https://brutzo.com/app/audio/tone-processor.js',
      'https://brutzo.com/app/audio/brutzo_tone_core.wasm',
    ],
  ])('resolves tone resources within app base %s', (appBase, processor, wasm) => {
    expect(toneResourceUrls(appBase)).toEqual({ processor, wasm })
  })

  it.each([
    ['https://unseen1980.github.io/brutzo/app/', 'https://unseen1980.github.io/brutzo/logo-mark.svg'],
    ['https://brutzo.com/app/', 'https://brutzo.com/logo-mark.svg'],
  ])('resolves the approved logo mark from app base %s', (appBase, expected) => {
    expect(logoPreviewUrl(appBase)).toBe(expected)
  })
})
