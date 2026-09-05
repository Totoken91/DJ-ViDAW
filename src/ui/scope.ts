/* ============================================================
   DJ ViDAW — VISUALISEUR
   Oscilloscope + spectre, rendus en tramage facon 8 bits parce
   qu'un degrade lisse en 2001 c'est de la triche.
   ============================================================ */

import { h } from './dom'

type Mode = 'scope' | 'bars' | 'lissajous'

export class Scope {
  el: HTMLElement
  private cv: HTMLCanvasElement
  private g: CanvasRenderingContext2D
  private mode: Mode = 'bars'
  private time = new Uint8Array(2048)
  private freq = new Uint8Array(1024)
  private hist: number[] = []
  analyser: AnalyserNode | null = null

  constructor() {
    this.cv = h('canvas', { style: { width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated' } })
    this.g = this.cv.getContext('2d')!
    this.el = h('div', {
      class: 'cv-host scanlines',
      style: { position: 'relative', cursor: 'pointer' },
      onclick: () => { this.mode = this.mode === 'bars' ? 'scope' : this.mode === 'scope' ? 'lissajous' : 'bars' },
      title: 'Clique pour changer de mode',
    }, this.cv)
  }

  resize() {
    const r = this.el.getBoundingClientRect()
    // basse resolution volontaire : le tramage doit se voir
    this.cv.width = Math.max(64, Math.floor(r.width / 2))
    this.cv.height = Math.max(32, Math.floor(r.height / 2))
  }

  draw() {
    const g = this.g
    const W = this.cv.width, H = this.cv.height
    if (W < 8 || H < 8) return
    g.fillStyle = '#080c10'
    g.fillRect(0, 0, W, H)

    // fond tramé
    g.fillStyle = 'rgba(0,255,156,.055)'
    for (let y = 0; y < H; y += 2) for (let x = (y / 2) % 2; x < W; x += 2) g.fillRect(x, y, 1, 1)

    if (!this.analyser) {
      g.fillStyle = '#1d6b48'; g.font = 'bold 9px monospace'
      g.fillText('NO SIGNAL', 6, H / 2)
      return
    }

    if (this.mode === 'bars') {
      this.analyser.getByteFrequencyData(this.freq)
      const bands = Math.min(40, Math.floor(W / 3))
      const bw = Math.max(1, Math.floor(W / bands) - 1)
      for (let i = 0; i < bands; i++) {
        // repartition logarithmique
        const a = Math.floor(Math.pow(i / bands, 1.9) * 480) + 1
        const b = Math.floor(Math.pow((i + 1) / bands, 1.9) * 480) + 2
        let v = 0
        for (let j = a; j < b && j < this.freq.length; j++) v = Math.max(v, this.freq[j])
        const hgt = Math.round((v / 255) * (H - 4))
        const x = i * (bw + 1)
        for (let y = 0; y < hgt; y += 2) {
          const n = y / (H - 4)
          g.fillStyle = n > 0.78 ? '#ff2e4d' : n > 0.5 ? '#ffd23d' : '#00ff9c'
          // tramage : une colonne sur deux decalee
          for (let px = 0; px < bw; px++) {
            if ((px + y / 2) % 2 === 0 || n < 0.6) g.fillRect(x + px, H - 2 - y, 1, 1)
          }
        }
        if (hgt > 1) { g.fillStyle = '#ffffff'; g.fillRect(x, H - 3 - hgt, bw, 1) }
      }
    } else if (this.mode === 'scope') {
      this.analyser.getByteTimeDomainData(this.time)
      g.fillStyle = '#00ff9c'
      const n = this.analyser.fftSize
      for (let x = 0; x < W; x++) {
        const i = Math.floor((x / W) * n)
        const v = (this.time[i] - 128) / 128
        const y = Math.round(H / 2 - v * (H / 2 - 2))
        g.fillRect(x, y, 1, 1)
        if (x > 0) {
          const pi = Math.floor(((x - 1) / W) * n)
          const py = Math.round(H / 2 - ((this.time[pi] - 128) / 128) * (H / 2 - 2))
          const step = py < y ? 1 : -1
          for (let yy = py; yy !== y; yy += step) if ((yy + x) % 2 === 0) g.fillRect(x, yy, 1, 1)
        }
      }
    } else {
      this.analyser.getByteTimeDomainData(this.time)
      let rms = 0
      for (let i = 0; i < 256; i++) { const v = (this.time[i] - 128) / 128; rms += v * v }
      rms = Math.sqrt(rms / 256)
      this.hist.push(rms)
      if (this.hist.length > W) this.hist.shift()
      for (let x = 0; x < this.hist.length; x++) {
        const v = this.hist[x]
        const hgt = Math.round(v * (H - 2) * 1.6)
        for (let y = 0; y < hgt; y += 1) {
          if ((x + y) % 2) continue
          const n = y / H
          g.fillStyle = n > 0.6 ? '#ff4fd8' : '#4fe9ff'
          g.fillRect(x, H / 2 - y / 2, 1, 1)
          g.fillRect(x, H / 2 + y / 2, 1, 1)
        }
      }
    }

    // cadre
    g.strokeStyle = 'rgba(0,255,156,.28)'; g.lineWidth = 1
    g.strokeRect(0.5, 0.5, W - 1, H - 1)
  }
}
