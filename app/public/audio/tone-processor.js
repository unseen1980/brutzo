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
        const { drive, tone, level } = message.params
        this.exports.tone_set_params(drive, tone, level)
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
