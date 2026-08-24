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

export function currentHarnessClipsUrl(): string {
  return harnessClipsUrl(document.baseURI)
}

export function currentMarketingSiteUrl(): string {
  return marketingSiteUrl(document.baseURI)
}
