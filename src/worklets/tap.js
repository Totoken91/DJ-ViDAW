/* Tap d'enregistrement : recopie l'entree vers la sortie et poste les blocs
   au thread principal pour l'encodage WAV. */
class TapProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.on = false
    this.port.onmessage = (e) => { this.on = !!e.data.rec }
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0]
    if (!out) return true
    const n = out[0] ? out[0].length : 128
    for (let c = 0; c < out.length; c++) {
      const s = inp && inp[c] ? inp[c] : null
      if (s) out[c].set(s); else out[c].fill(0)
    }
    if (this.on && inp && inp[0]) {
      const l = new Float32Array(n), r = new Float32Array(n)
      l.set(inp[0]); r.set(inp[1] || inp[0])
      this.port.postMessage({ l, r }, [l.buffer, r.buffer])
    }
    return true
  }
}
registerProcessor('vidaw-tap', TapProcessor)
