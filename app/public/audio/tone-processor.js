class BrutzoToneProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.exports = null
    this.port.onmessage = (event) => {
      void this.handleMessage(event.data)
    }
  }

  async handleMessage(message) {
    try {
      if (message.type === 'initialize') {
        const instance = await WebAssembly.instantiate(message.wasm, {})
        this.exports = instance.instance.exports
        this.exports.tone_init(sampleRate)
        this.port.postMessage({ type: 'ready' })
      } else if (message.type === 'params' && this.exports) {
        const { inputTrimDb, drive, tone, cabinet, level, gateThresholdDb, gateEnabled } = message.params
        this.exports.tone_set_params(inputTrimDb, drive, tone, cabinet, level, gateThresholdDb, gateEnabled ? 1 : 0)
      }
    } catch (error) {
      this.port.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (!output?.length) return true
    const source = input?.[0]
    for (let frame = 0; frame < output[0].length; frame++) {
      const sample = this.exports ? this.exports.tone_process_sample(source?.[frame] ?? 0) : 0
      for (let channel = 0; channel < output.length; channel++) output[channel][frame] = sample
    }
    return true
  }
}

registerProcessor('brutzo-tone', BrutzoToneProcessor)

class BrutzoRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.recording = false
    this.chunk = null
    this.chunkOffset = 0
    this.totalFrames = 0
    this.droppedFrames = 0
    this.pool = []
    this.port.onmessage = (event) => {
      if (event.data?.type === 'record-start') {
        this.recording = true
        this.pool = Array.from({ length: 8 }, () => new Float32Array(4096))
        this.chunk = this.pool.pop()
        this.chunkOffset = 0
        this.totalFrames = 0
        this.droppedFrames = 0
      } else if (event.data?.type === 'record-buffer' && event.data.buffer) {
        this.pool.push(new Float32Array(event.data.buffer))
      } else if (event.data?.type === 'record-stop') {
        this.flush()
        this.recording = false
        this.port.postMessage({ type: 'record-stopped', frames: this.totalFrames, droppedFrames: this.droppedFrames })
      }
    }
  }

  flush() {
    if (!this.chunk || this.chunkOffset === 0) return
    const data = this.chunk
    this.port.postMessage({ type: 'record-chunk', data, frames: this.chunkOffset }, [data.buffer])
    this.chunk = this.pool.pop() ?? null
    this.chunkOffset = 0
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    const source = input?.[0]
    for (let channel = 0; channel < output.length; channel++) {
      const channelInput = input?.[channel] ?? source
      if (channelInput) output[channel].set(channelInput)
      else output[channel].fill(0)
    }
    if (this.recording && source) {
      for (let i = 0; i < source.length; i++) {
        if (!this.chunk) {
          this.droppedFrames++
          continue
        }
        this.chunk[this.chunkOffset++] = source[i]
        this.totalFrames++
        if (this.chunkOffset === this.chunk.length) this.flush()
      }
    }
    return true
  }
}

registerProcessor('brutzo-recorder', BrutzoRecorderProcessor)
