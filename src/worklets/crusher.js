/* Bitcrusher + sample-rate reducer + grain noise.
   Vanilla JS : ce fichier est chargé tel quel par audioWorklet.addModule(). */
class CrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 6, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'down', defaultValue: 6, minValue: 1, maxValue: 64, automationRate: 'k-rate' },
      { name: 'noise', defaultValue: 0.05, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ]
  }
  constructor() {
    super()
    this.phase = 0
    this.held = [0, 0]
    this.dead = false
    this.port.onmessage = (e) => { if (e.data === 'kill') this.dead = true }
  }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0]
    if (!output) return !this.dead
    const bits = params.bits[0], down = Math.max(1, params.down[0]), noise = params.noise[0]
    const levels = Math.pow(2, bits) - 1
    const nCh = output.length
    if (!input || input.length === 0) {
      for (let c = 0; c < nCh; c++) output[c].fill(0)
      return !this.dead
    }
    const frames = output[0].length
    for (let i = 0; i < frames; i++) {
      this.phase += 1
      const grab = this.phase >= down
      if (grab) this.phase -= down
      for (let c = 0; c < nCh; c++) {
        const src = input[c] || input[0]
        const x = src ? src[i] : 0
        if (grab) {
          let q = Math.round((x * 0.5 + 0.5) * levels) / levels * 2 - 1
          if (noise > 0) q += (Math.random() * 2 - 1) * noise * 0.08
          this.held[c] = q
        }
        output[c][i] = this.held[c] === undefined ? 0 : this.held[c]
      }
    }
    return !this.dead
  }
}
registerProcessor('vidaw-crusher', CrusherProcessor)
