import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const worklet = readFileSync(fileURLToPath(new URL('../../public/audio/tone-processor.js', import.meta.url)), 'utf8')
const engine = readFileSync(fileURLToPath(new URL('./engine.ts', import.meta.url)), 'utf8')

describe('Phase 1 real-time wiring', () => {
  it('registers tone and final-output recorder processors', () => {
    expect(worklet).toContain("registerProcessor('brutzo-tone'")
    expect(worklet).toContain("registerProcessor('brutzo-recorder'")
  })

  it('requests the lowest browser latency hint', () => {
    expect(engine).toContain('new AudioContext({ latencyHint: 0 })')
  })

  it('does not allocate recording buffers inside the render callback', () => {
    const recorder = worklet.slice(worklet.indexOf('class BrutzoRecorderProcessor'))
    const processBody = recorder.slice(recorder.indexOf('process(inputs, outputs)'), recorder.indexOf('registerProcessor'))
    expect(processBody).not.toContain('new Float32Array')
    expect(processBody).not.toContain('.slice(')
  })
})
