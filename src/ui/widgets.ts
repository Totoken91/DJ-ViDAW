/* ============================================================
   DJ ViDAW — WIDGETS D'INSTRUMENT
   Des commandes qui montrent ce qu'elles font : enveloppes qu'on
   attrape par leurs points, formes d'onde dessinees, oscilloscope
   branche sur la vraie sortie, LFO dont le point tourne.
   ============================================================ */

import { h, drag } from './dom'
import { clamp } from '../core/state'
import type { Env, Lfo, Wave } from '../audio/synth'
import { LFO_DIVS } from '../audio/synth'

const dpr = () => Math.min(2, window.devicePixelRatio || 1)

function fitCanvas(cv: HTMLCanvasElement, w: number, hgt: number): CanvasRenderingContext2D | null {
  const k = dpr()
  if (cv.width !== Math.round(w * k)) { cv.width = Math.round(w * k); cv.height = Math.round(hgt * k) }
  const g = cv.getContext('2d')
  if (!g) return null
  g.setTransform(k, 0, 0, k, 0, 0)
  return g
}

/* ------------------------------------------------------------------ */
/* Une periode de la forme d'onde choisie                              */
/* ------------------------------------------------------------------ */

export function waveAt(wave: Wave, phase: number, pw = 0.5): number {
  const t = phase - Math.floor(phase)
  switch (wave) {
    case 'saw': return 1 - 2 * t
    case 'square': return t < 0.5 ? 1 : -1
    case 'pulse': return t < pw ? 1 : -1
    case 'triangle': return t < 0.5 ? 4 * t - 1 : 3 - 4 * t
    case 'sine': return Math.sin(t * Math.PI * 2)
    case 'noise': return Math.sin(t * 97.3) * Math.sin(t * 43.7) * Math.cos(t * 211.1)
  }
}

export function waveThumb(w = 46, hgt = 26): { el: HTMLCanvasElement; draw(wave: Wave, pw: number, color: string): void } {
  const cv = h('canvas', { class: 'wv-thumb' }) as HTMLCanvasElement
  cv.style.width = `${w}px`; cv.style.height = `${hgt}px`
  return {
    el: cv,
    draw(wave, pw, color) {
      const g = fitCanvas(cv, w, hgt)
      if (!g) return
      g.clearRect(0, 0, w, hgt)
      g.fillStyle = '#0d1017'; g.fillRect(0, 0, w, hgt)
      g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1
      g.beginPath(); g.moveTo(0, hgt / 2 + .5); g.lineTo(w, hgt / 2 + .5); g.stroke()
      g.beginPath()
      const cycles = 2
      for (let x = 0; x <= w; x++) {
        const v = waveAt(wave, (x / w) * cycles, pw)
        const y = hgt / 2 - v * (hgt / 2 - 3)
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y)
      }
      g.strokeStyle = color; g.lineWidth = 1.6; g.lineJoin = 'round'
      g.stroke()
    },
  }
}

/* ------------------------------------------------------------------ */
/* Enveloppe manipulable                                                */
/* ------------------------------------------------------------------ */

export interface EnvEditor { el: HTMLElement; draw(): void }

export function envEditor(
  get: () => Env, onChange: () => void, color: string, hgt = 104,
): EnvEditor {
  // La largeur suit le conteneur : mesuree a chaque trace plutot que figee,
  // pour que la courbe occupe toute la plaque quelle que soit la fenetre.
  let w = 300
  const cv = h('canvas', { class: 'env-cv' }) as HTMLCanvasElement
  cv.style.width = '100%'; cv.style.height = `${hgt}px`
  const wrap = h('div', {
    class: 'env-wrap',
    dataset: { tip: 'Attrape les points pour regler attaque, declin, maintien et relache' },
  }, cv)

  const PAD = 10, TOP = 12, BOT = hgt - 16
  const span = () => {
    const e = get()
    return Math.max(1.2, e.a + e.d + e.r + 0.6)
  }
  const hold = () => span() * 0.16
  const xOf = (t: number) => PAD + (t / span()) * (w - PAD * 2)
  const tOf = (x: number) => clamp(((x - PAD) / (w - PAD * 2)) * span(), 0, span())

  const points = () => {
    const e = get()
    const sy = BOT - (BOT - TOP) * clamp(e.s, 0, 1)
    return {
      p1: { x: xOf(e.a), y: TOP },
      p2: { x: xOf(e.a + e.d), y: sy },
      p3: { x: xOf(e.a + e.d + hold()), y: sy },
      p4: { x: xOf(e.a + e.d + hold() + e.r), y: BOT },
      sy,
    }
  }

  let held: 'p1' | 'p2' | 'p4' | null = null
  const near = (x: number, y: number) => {
    const p = points()
    for (const k of ['p1', 'p2', 'p4'] as const) {
      const q = p[k]
      if (Math.hypot(q.x - x, q.y - y) < 13) return k
    }
    return null
  }

  const pos = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * hgt }
  }

  drag(wrap, (_dx, _dy, e) => {
    if (!held) return
    const { x, y } = pos(e)
    const en = get()
    if (held === 'p1') en.a = clamp(tOf(x), 0, 3)
    else if (held === 'p2') {
      en.d = clamp(tOf(x) - en.a, 0.005, 3)
      en.s = clamp(1 - (y - TOP) / (BOT - TOP), 0, 1)
    } else {
      en.r = clamp(tOf(x) - (en.a + en.d + hold()), 0.008, 4)
    }
    onChange(); draw()
  }, (e) => {
    const { x, y } = pos(e)
    held = near(x, y)
    if (!held) {
      // clic dans le vide : on saisit le point le plus proche horizontalement
      const p = points()
      const d = [['p1', p.p1.x], ['p2', p.p2.x], ['p4', p.p4.x]] as const
      held = d.reduce((a, b) => (Math.abs(b[1] - x) < Math.abs(a[1] - x) ? b : a))[0] as 'p1'
    }
    wrap.classList.add('grabbing')
    return true
  }, () => { held = null; wrap.classList.remove('grabbing') })

  cv.addEventListener('pointermove', (e) => {
    if (held) return
    const { x, y } = pos(e)
    cv.style.cursor = near(x, y) ? 'grab' : 'crosshair'
  })

  function draw() {
    w = Math.max(160, cv.clientWidth || w)
    const g = fitCanvas(cv, w, hgt)
    if (!g) return
    const e = get()
    const p = points()
    g.clearRect(0, 0, w, hgt)
    g.fillStyle = '#0d1017'; g.fillRect(0, 0, w, hgt)

    // quadrillage
    g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1
    for (let i = 1; i < 6; i++) {
      const x = (w / 6) * i
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, hgt - 12); g.stroke()
    }
    for (let i = 1; i < 3; i++) {
      const y = TOP + ((BOT - TOP) / 3) * i
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke()
    }

    // surface sous la courbe
    g.beginPath()
    g.moveTo(PAD, BOT)
    g.lineTo(p.p1.x, p.p1.y)
    g.bezierCurveTo(p.p1.x + (p.p2.x - p.p1.x) * .35, p.p1.y,
                    p.p1.x + (p.p2.x - p.p1.x) * .45, p.p2.y, p.p2.x, p.p2.y)
    g.lineTo(p.p3.x, p.p3.y)
    g.bezierCurveTo(p.p3.x + (p.p4.x - p.p3.x) * .35, p.p3.y,
                    p.p3.x + (p.p4.x - p.p3.x) * .5, BOT, p.p4.x, p.p4.y)
    const fill = g.createLinearGradient(0, TOP, 0, BOT)
    fill.addColorStop(0, hexA(color, .42))
    fill.addColorStop(1, hexA(color, .05))
    g.lineTo(p.p4.x, BOT); g.closePath()
    g.fillStyle = fill; g.fill()

    // la courbe elle-meme
    g.beginPath()
    g.moveTo(PAD, BOT)
    g.lineTo(p.p1.x, p.p1.y)
    g.bezierCurveTo(p.p1.x + (p.p2.x - p.p1.x) * .35, p.p1.y,
                    p.p1.x + (p.p2.x - p.p1.x) * .45, p.p2.y, p.p2.x, p.p2.y)
    g.lineTo(p.p3.x, p.p3.y)
    g.bezierCurveTo(p.p3.x + (p.p4.x - p.p3.x) * .35, p.p3.y,
                    p.p3.x + (p.p4.x - p.p3.x) * .5, BOT, p.p4.x, p.p4.y)
    g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke()

    // zone de maintien, hachuree
    g.save()
    g.beginPath(); g.rect(p.p2.x, TOP, p.p3.x - p.p2.x, BOT - TOP); g.clip()
    g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1
    for (let x = p.p2.x - 40; x < p.p3.x + 40; x += 5) {
      g.beginPath(); g.moveTo(x, BOT); g.lineTo(x + 40, TOP); g.stroke()
    }
    g.restore()

    // poignees
    for (const [k, q] of [['A', p.p1], ['D', p.p2], ['R', p.p4]] as const) {
      g.beginPath(); g.arc(q.x, q.y, 4.6, 0, Math.PI * 2)
      g.fillStyle = '#0d1017'; g.fill()
      g.strokeStyle = color; g.lineWidth = 2; g.stroke()
      g.fillStyle = 'rgba(255,255,255,.9)'
      g.font = 'bold 8px Tahoma, sans-serif'
      g.fillText(k, q.x - 3, q.y - 8)
    }

    // legende chiffree
    const ms = (v: number) => (v >= 1 ? `${v.toFixed(2)}s` : `${Math.round(v * 1000)}ms`)
    g.fillStyle = 'rgba(190,200,216,.75)'
    g.font = '9px "Courier New", monospace'
    g.fillText(`A ${ms(e.a)}   D ${ms(e.d)}   S ${Math.round(e.s * 100)}%   R ${ms(e.r)}`, PAD, hgt - 3)
  }

  // premiere mesure apres insertion dans le document
  requestAnimationFrame(draw)
  draw()
  return { el: wrap, draw }
}

/* ------------------------------------------------------------------ */
/* Oscilloscope + spectre, branches sur la vraie sortie                 */
/* ------------------------------------------------------------------ */

export interface Scope { el: HTMLElement; tick(): void; setAnalyser(a: AnalyserNode | null): void }

/** L'afficheur se dimensionne sur son conteneur : il occupe la colonne
    entiere du panneau, quelle que soit la taille de la fenetre. */
export function scopeDisplay(): Scope {
  const cv = h('canvas', { class: 'scope-cv' }) as HTMLCanvasElement
  cv.style.width = '100%'; cv.style.height = '100%'
  const el = h('div', { class: 'scope' }, cv)
  let an: AnalyserNode | null = null
  let time = new Uint8Array(2048)
  let freq = new Uint8Array(1024)
  const peaks = new Float32Array(48)

  return {
    el,
    setAnalyser(a) {
      an = a
      if (a) { time = new Uint8Array(a.fftSize); freq = new Uint8Array(a.frequencyBinCount) }
    },
    tick() {
      const rect = el.getBoundingClientRect()
      const W = Math.max(60, rect.width), H = Math.max(60, rect.height)
      const g = fitCanvas(cv, W, H)
      if (!g) return
      g.clearRect(0, 0, W, H)
      g.fillStyle = '#080b11'; g.fillRect(0, 0, W, H)

      const waveH = H * 0.56
      const specY = waveH + 6
      const specH = H - specY - 4

      // grille de l'ecran
      g.strokeStyle = 'rgba(90,150,120,.10)'; g.lineWidth = 1
      for (let i = 1; i < 8; i++) {
        const x = (W / 8) * i
        g.beginPath(); g.moveTo(x, 2); g.lineTo(x, waveH); g.stroke()
      }
      for (let i = 1; i < 4; i++) {
        const y = (waveH / 4) * i
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke()
      }
      g.strokeStyle = 'rgba(120,190,150,.2)'
      g.beginPath(); g.moveTo(0, waveH / 2); g.lineTo(W, waveH / 2); g.stroke()

      if (!an) {
        g.fillStyle = 'rgba(120,190,150,.45)'
        g.font = 'bold 9px "Courier New", monospace'
        g.fillText('PAS DE SIGNAL', 8, waveH / 2 - 6)
        return
      }

      an.getByteTimeDomainData(time)
      // synchronisation sur le premier passage par zero montant :
      // sans elle, la trace glisse en permanence
      let start = 0
      for (let i = 1; i < time.length / 2; i++) {
        if (time[i - 1] < 128 && time[i] >= 128) { start = i; break }
      }
      const n = Math.min(time.length - start, Math.floor(time.length / 2))
      g.beginPath()
      let energy = 0
      for (let x = 0; x <= W; x++) {
        const i = start + Math.floor((x / W) * n)
        const v = (time[i] - 128) / 128
        energy += Math.abs(v)
        const y = waveH / 2 - v * (waveH / 2 - 4)
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y)
      }
      const lively = energy / W > 0.006
      g.strokeStyle = lively ? '#57e08a' : 'rgba(87,224,138,.35)'
      g.lineWidth = 1.7; g.lineJoin = 'round'
      g.stroke()
      // remanence : un second trait plus large et transparent
      g.strokeStyle = 'rgba(87,224,138,.14)'; g.lineWidth = 5; g.stroke()

      // spectre en barres, repartition logarithmique
      an.getByteFrequencyData(freq)
      const bands = Math.min(peaks.length, Math.max(16, Math.floor(W / 7)))
      const bw = W / bands
      for (let i = 0; i < bands; i++) {
        const a = Math.floor(Math.pow(i / bands, 2) * (freq.length * 0.7)) + 1
        const b = Math.floor(Math.pow((i + 1) / bands, 2) * (freq.length * 0.7)) + 2
        let v = 0
        for (let j = a; j < b && j < freq.length; j++) v = Math.max(v, freq[j])
        const lvl = v / 255
        peaks[i] = Math.max(lvl, peaks[i] - 0.022)
        const hh = lvl * specH
        const x = i * bw
        const grad = g.createLinearGradient(0, specY + specH, 0, specY)
        grad.addColorStop(0, '#2a6f47')
        grad.addColorStop(.7, '#57e08a')
        grad.addColorStop(1, '#c9f7a8')
        g.fillStyle = grad
        g.fillRect(x + .5, specY + specH - hh, bw - 1.5, hh)
        if (peaks[i] > 0.02) {
          g.fillStyle = 'rgba(220,255,220,.75)'
          g.fillRect(x + .5, specY + specH - peaks[i] * specH - 1, bw - 1.5, 1.5)
        }
      }
      g.strokeStyle = 'rgba(90,150,120,.18)'
      g.beginPath(); g.moveTo(0, specY - 3); g.lineTo(W, specY - 3); g.stroke()
    },
  }
}

/* ------------------------------------------------------------------ */
/* LFO : la forme, et le point qui la parcourt                          */
/* ------------------------------------------------------------------ */

export interface LfoView { el: HTMLCanvasElement; tick(bpm: number): void }

export function lfoDisplay(get: () => Lfo, color: string, w = 108, hgt = 40): LfoView {
  const cv = h('canvas', { class: 'lfo-cv' }) as HTMLCanvasElement
  cv.style.width = `${w}px`; cv.style.height = `${hgt}px`
  const shSeed = Array.from({ length: 24 }, () => Math.random() * 2 - 1)

  const shapeAt = (l: Lfo, ph: number): number => {
    const t = ph - Math.floor(ph)
    switch (l.shape) {
      case 'sine': return Math.sin(t * Math.PI * 2)
      case 'tri': return t < 0.5 ? 4 * t - 1 : 3 - 4 * t
      case 'saw': return 1 - 2 * t
      case 'square': return t < 0.5 ? 1 : -1
      case 'sh': return shSeed[Math.floor(t * 6) % shSeed.length]
    }
  }

  return {
    el: cv,
    tick(bpm) {
      const g = fitCanvas(cv, w, hgt)
      if (!g) return
      const l = get()
      g.clearRect(0, 0, w, hgt)
      g.fillStyle = '#0d1017'; g.fillRect(0, 0, w, hgt)
      g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1
      g.beginPath(); g.moveTo(0, hgt / 2 + .5); g.lineTo(w, hgt / 2 + .5); g.stroke()

      const cycles = 2
      g.beginPath()
      for (let x = 0; x <= w; x++) {
        const v = shapeAt(l, (x / w) * cycles)
        const y = hgt / 2 - v * (hgt / 2 - 4)
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y)
      }
      g.strokeStyle = color; g.lineWidth = 1.7; g.lineJoin = 'round'; g.stroke()

      const rate = l.sync
        ? (bpm / 60) / LFO_DIVS[clamp(Math.round(l.div), 0, LFO_DIVS.length - 1)]
        : clamp(l.rate, 0.01, 40)
      const ph = ((performance.now() / 1000) * rate) % 1
      const px = (ph / cycles) * w
      const py = hgt / 2 - shapeAt(l, ph) * (hgt / 2 - 4)
      g.beginPath(); g.arc(px, py, 3, 0, Math.PI * 2)
      g.fillStyle = '#fff'; g.fill()
      g.strokeStyle = color; g.lineWidth = 1.4; g.stroke()
    },
  }
}

function hexA(hex: string, a: number): string {
  const m = hex.replace('#', '')
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
