import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const htmlPath = path.join(appRoot, 'dist', 'index.html')
const html = fs.readFileSync(htmlPath, 'utf8')

const assetUrls = [...html.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((match) => match[1])
if (assetUrls.length === 0) {
  throw new Error('Built index.html contains no asset URLs')
}

const unsafe = assetUrls.filter((url) => url.startsWith('/'))
if (unsafe.length > 0) {
  throw new Error(`Built asset URLs must be deployment-relative, found: ${unsafe.join(', ')}`)
}

for (const url of assetUrls) {
  const assetPath = path.resolve(path.dirname(htmlPath), url)
  if (!fs.existsSync(assetPath)) throw new Error(`Built asset is missing: ${url}`)
}

console.log(`Verified ${assetUrls.length} deployment-relative build assets`)

for (const resource of ['audio/tone-processor.js', 'audio/brutzo_tone_core.wasm']) {
  const resourcePath = path.join(appRoot, 'dist', resource)
  if (!fs.existsSync(resourcePath) || fs.statSync(resourcePath).size === 0) {
    throw new Error(`Built tone resource is missing or empty: ${resource}`)
  }
}
const processorSource = fs.readFileSync(path.join(appRoot, 'dist', 'audio', 'tone-processor.js'), 'utf8')
for (const processor of ['brutzo-tone', 'brutzo-recorder']) {
  if (!processorSource.includes(`registerProcessor('${processor}'`)) {
    throw new Error(`Built AudioWorklet is missing processor: ${processor}`)
  }
}
console.log('Verified tone/recorder AudioWorklets and tone WASM resources')
