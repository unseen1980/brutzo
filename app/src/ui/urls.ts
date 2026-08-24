/**
 * App-relative URLs that survive both a GitHub Pages repository prefix
 * (/brutzo/app/) and a custom-domain root (/app/).
 */
export function harnessClipsUrl(appBase: string): string {
  return new URL('../harness/clips', appBase).href.replace(/\/$/, '')
}

export function marketingSiteUrl(appBase: string): string {
  return new URL('../', appBase).href
}

export function logoPreviewUrl(appBase: string): string {
  return new URL('../logo-mark.svg', appBase).href
}

export function toneResourceUrls(appBase: string): { processor: string; wasm: string } {
  return {
    processor: new URL('audio/tone-processor.js', appBase).href,
    wasm: new URL('audio/brutzo_tone_core.wasm', appBase).href,
  }
}

export function currentToneResourceUrls(): { processor: string; wasm: string } {
  return toneResourceUrls(document.baseURI)
}


export function currentHarnessClipsUrl(): string {
  return harnessClipsUrl(document.baseURI)
}

export function currentMarketingSiteUrl(): string {
  return marketingSiteUrl(document.baseURI)
}

export function currentLogoPreviewUrl(): string {
  return logoPreviewUrl(document.baseURI)
}
