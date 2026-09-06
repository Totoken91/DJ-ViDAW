/* ============================================================
   DJ ViDAW — AFFICHEUR D'EGALISEUR

   La courbe se manipule directement : on attrape un point, on le
   deplace. Horizontal = frequence, vertical = gain, molette = largeur.
   Les potards viendraient apres — ici, la forme du son est l'interface.

   Le spectre du signal reel est peint derriere la courbe : regler un EQ
   a l'aveugle, c'est deviner ou se trouve le probleme.
   ============================================================ */

import { h } from './dom'
import { contextMenu } from './menu'
import { clamp } from '../core/state'
import {
  eqResponse, eqFreqAxis, BAND_NAMES, EQ_MIN_DB, EQ_MAX_DB,
  type EqBand,
} from '../audio/eq'

const F_LO = 20, F_HI = 20000
const DB = 18

/** Une couleur par bande : la meme sur le point, la poignee et la ligne. */
export const BAND_COLORS = ['#ff5cb0', '#ffa54d', '#8ee06a', '#5fe6ff', '#b48cff']

export interface EqView {
  el: HTMLElement
  draw(): void
  setAnalyser(a: AnalyserNode | null): void
  /** Bande survolee ou attrapee, pour l'afficheur en dessous. */
  active: number
}

export function eqView(opts: {
  bands: EqBand[]
  onChange: (band: number) => void
  onActive?: (i: number) => void
  height?: number
}): EqView {
  const cv = h('canvas', { class: 'eq-cv' })
  const el = h('div', { class: 'eq-view' }, cv)
  if (opts.height) el.style.height = `${opts.height}px`
  const g = cv.getContext('2d')!

  let analyser: AnalyserNode | null = null
  let spec: Uint8Array | null = null
  let hover = -1
  let grab = -1
  let sampleRate = 48000

  const axis = eqFreqAxis(240, F_LO, F_HI)
  const curve = new Float32Array(axis.length)

  /* --- conversions --- */
  const xOf = (f: number, w: number) => (Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * w
  const fOf = (x: number, w: number) => F_LO * Math.pow(F_HI / F_LO, clamp(x / w, 0, 1))
  const yOf = (db: number, hh: number) => hh / 2 - (clamp(db, -DB, DB) / DB) * (hh / 2 - 6)
  const dbOf = (y: number, hh: number) => clamp(((hh / 2 - y) / (hh / 2 - 6)) * DB, -DB, DB)

  function nodeAt(px: number, py: number, w: number, hh: number): number {
    let best = -1, bd = 22 * 22
    opts.bands.forEach((b, i) => {
      const dx = px - xOf(b.f, w), dy = py - yOf(b.g, hh)
      const d = dx * dx + dy * dy
      if (d < bd) { bd = d; best = i }
    })
    return best
  }

  function draw() {
    const w = cv.clientWidth || el.clientWidth
    const hh = cv.clientHeight || el.clientHeight
    if (w < 8 || hh < 8) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(hh * dpr)) {
      cv.width = Math.floor(w * dpr); cv.height = Math.floor(hh * dpr)
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, hh)

    /* --- fond --- */
    const bg = g.createLinearGradient(0, 0, 0, hh)
    bg.addColorStop(0, '#141024')
    bg.addColorStop(1, '#0b0916')
    g.fillStyle = bg
    g.fillRect(0, 0, w, hh)

    /* --- spectre du signal --- */
    if (analyser) {
      if (!spec || spec.length !== analyser.frequencyBinCount) {
        spec = new Uint8Array(analyser.frequencyBinCount)
      }
      analyser.getByteFrequencyData(spec as Uint8Array<ArrayBuffer>)
      const nyq = sampleRate / 2
      g.beginPath()
      g.moveTo(0, hh)
      for (let x = 0; x <= w; x += 2) {
        const f = fOf(x, w)
        const bin = clamp(Math.round((f / nyq) * spec.length), 0, spec.length - 1)
        // un peu de lissage : sinon la trace saute d'un pixel a l'autre
        const v = (spec[bin] + (spec[bin + 1] ?? spec[bin])) / 2 / 255
        g.lineTo(x, hh - Math.pow(v, 1.25) * hh * 0.92)
      }
      g.lineTo(w, hh)
      g.closePath()
      const sg = g.createLinearGradient(0, 0, 0, hh)
      sg.addColorStop(0, 'rgba(120,200,255,.30)')
      sg.addColorStop(1, 'rgba(120,200,255,.05)')
      g.fillStyle = sg
      g.fill()
    }

    /* --- grille --- */
    g.font = '9px "Courier New", monospace'
    g.textBaseline = 'top'
    for (const f of [30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 15000]) {
      const x = xOf(f, w)
      const major = f === 100 || f === 1000 || f === 10000
      g.strokeStyle = major ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.06)'
      g.lineWidth = 1
      g.beginPath(); g.moveTo(x + .5, 0); g.lineTo(x + .5, hh); g.stroke()
      if (major) {
        g.fillStyle = 'rgba(180,190,215,.6)'
        g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 3, 3)
      }
    }
    for (const db of [-12, -6, 6, 12]) {
      const y = yOf(db, hh)
      g.strokeStyle = 'rgba(255,255,255,.06)'
      g.beginPath(); g.moveTo(0, y + .5); g.lineTo(w, y + .5); g.stroke()
    }
    const y0 = yOf(0, hh)
    g.strokeStyle = 'rgba(255,255,255,.28)'
    g.beginPath(); g.moveTo(0, y0 + .5); g.lineTo(w, y0 + .5); g.stroke()
    g.fillStyle = 'rgba(180,190,215,.55)'
    g.fillText('0 dB', 4, y0 + 3)
    g.fillText(`+${DB}`, 4, 3 + 11)

    /* --- courbe totale --- */
    const r = eqResponse(opts.bands, axis, sampleRate)
    curve.set(r)
    g.beginPath()
    for (let i = 0; i < axis.length; i++) {
      const x = xOf(axis[i], w), y = yOf(r[i], hh)
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y)
    }
    // remplissage entre la courbe et le zero : on voit d'un coup ce qui
    // est ajoute et ce qui est retire
    g.save()
    g.lineTo(w, y0); g.lineTo(0, y0); g.closePath()
    const cg = g.createLinearGradient(0, 0, 0, hh)
    cg.addColorStop(0, 'rgba(255,92,176,.30)')
    cg.addColorStop(.5, 'rgba(255,92,176,.10)')
    cg.addColorStop(1, 'rgba(95,230,255,.26)')
    g.fillStyle = cg
    g.fill()
    g.restore()

    g.beginPath()
    for (let i = 0; i < axis.length; i++) {
      const x = xOf(axis[i], w), y = yOf(r[i], hh)
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y)
    }
    g.strokeStyle = '#ffd9ef'
    g.lineWidth = 2
    g.shadowColor = 'rgba(255,92,176,.75)'
    g.shadowBlur = 7
    g.stroke()
    g.shadowBlur = 0

    /* --- points de bande --- */
    opts.bands.forEach((b, i) => {
      const x = xOf(b.f, w), y = yOf(b.g, hh)
      const on = b.on
      const act = i === grab || i === hover
      g.beginPath(); g.arc(x, y, act ? 9 : 7, 0, Math.PI * 2)
      g.fillStyle = on ? BAND_COLORS[i] : '#3a3550'
      g.globalAlpha = on ? 1 : .55
      g.fill()
      g.globalAlpha = 1
      g.lineWidth = 1.5
      g.strokeStyle = act ? '#fff' : 'rgba(0,0,0,.65)'
      g.stroke()
      g.fillStyle = '#0d0a1d'
      g.font = '700 9px Tahoma, "DejaVu Sans", sans-serif'
      g.textAlign = 'center'; g.textBaseline = 'middle'
      g.fillText(String(i + 1), x, y + .5)
      g.textAlign = 'left'; g.textBaseline = 'top'
      if (act) {
        const lbl = `${BAND_NAMES[i]} ${Math.round(b.f)}Hz ${b.g > 0 ? '+' : ''}${b.g.toFixed(1)}dB`
        g.font = '9px "Courier New", monospace'
        const tw = g.measureText(lbl).width + 8
        const tx = clamp(x - tw / 2, 2, w - tw - 2)
        const ty = clamp(y - 24, 2, hh - 16)
        g.fillStyle = 'rgba(10,8,20,.88)'
        g.fillRect(tx, ty, tw, 14)
        g.strokeStyle = BAND_COLORS[i]; g.lineWidth = 1
        g.strokeRect(tx + .5, ty + .5, tw - 1, 13)
        g.fillStyle = '#e8dcff'
        g.fillText(lbl, tx + 4, ty + 3)
      }
    })
  }

  /* --- manipulation --- */
  const pos = (e: { clientX: number; clientY: number }) => {
    const r = cv.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height }
  }

  cv.addEventListener('pointerdown', (e) => {
    const { x, y, w, h: hh } = pos(e)
    const i = nodeAt(x, y, w, hh)
    if (e.button === 2) {
      if (i >= 0) bandMenu(e, i)
      return
    }
    if (e.button === 1) {           // clic milieu : bande a plat
      if (i >= 0) { e.preventDefault(); opts.bands[i].g = 0; opts.onChange(i); draw() }
      return
    }
    if (i < 0) return
    grab = i
    opts.onActive?.(i)
    cv.setPointerCapture(e.pointerId)
    e.preventDefault()
  })

  cv.addEventListener('pointermove', (e) => {
    const { x, y, w, h: hh } = pos(e)
    if (grab < 0) {
      const i = nodeAt(x, y, w, hh)
      if (i !== hover) { hover = i; cv.style.cursor = i >= 0 ? 'grab' : 'crosshair'; draw() }
      if (i >= 0) opts.onActive?.(i)
      return
    }
    const b = opts.bands[grab]
    const fine = e.shiftKey ? 0.25 : 1
    if (fine === 1) {
      b.f = clamp(fOf(x, w), 20, 20000)
      b.g = dbOf(y, hh)
    } else {
      // mode fin : on avance d'un quart de ce que fait la souris
      b.f = clamp(b.f * Math.pow(fOf(x, w) / b.f, fine), 20, 20000)
      b.g = clamp(b.g + (dbOf(y, hh) - b.g) * fine, EQ_MIN_DB, EQ_MAX_DB)
    }
    if (!b.on) b.on = true
    opts.onChange(grab)
    draw()
  })

  const release = (e: PointerEvent) => {
    if (grab < 0) return
    grab = -1
    try { cv.releasePointerCapture(e.pointerId) } catch { /* deja relache */ }
    draw()
  }
  cv.addEventListener('pointerup', release)
  cv.addEventListener('pointercancel', release)

  cv.addEventListener('dblclick', (e) => {
    const { x, y, w, h: hh } = pos(e)
    const i = nodeAt(x, y, w, hh)
    if (i < 0) return
    opts.bands[i].g = 0
    opts.onChange(i); draw()
  })

  cv.addEventListener('wheel', (e) => {
    const { x, y, w, h: hh } = pos(e)
    const i = nodeAt(x, y, w, hh)
    if (i < 0) return
    e.preventDefault()
    const b = opts.bands[i]
    // Les plateaux ignorent Q dans Web Audio : la molette y regle le gain,
    // sinon elle ne ferait rien du tout.
    if (b.type === 'lowshelf' || b.type === 'highshelf') {
      b.g = clamp(b.g - Math.sign(e.deltaY) * (e.shiftKey ? 0.2 : 0.8), EQ_MIN_DB, EQ_MAX_DB)
    } else {
      b.q = clamp(b.q * (e.deltaY > 0 ? 0.88 : 1.14), 0.15, 18)
    }
    opts.onChange(i); draw()
  }, { passive: false })

  cv.addEventListener('contextmenu', (e) => e.preventDefault())

  function bandMenu(e: MouseEvent, i: number) {
    const b = opts.bands[i]
    const shelf = b.type === 'lowshelf' || b.type === 'highshelf'
    contextMenu(e, [
      { label: b.on ? 'Desactiver la bande' : 'Activer la bande', ico: 'plug', checked: b.on,
        onClick: () => { b.on = !b.on; opts.onChange(i); draw() } },
      { label: 'Remettre a plat', ico: 'loop', accel: 'double-clic',
        onClick: () => { b.g = 0; opts.onChange(i); draw() } },
      '-',
      { label: 'Largeur', ico: 'wave', disabled: shelf, sub: [
        { label: 'Tres large (0.4)', checked: Math.abs(b.q - 0.4) < .05, onClick: () => { b.q = 0.4; opts.onChange(i); draw() } },
        { label: 'Large (0.8)', checked: Math.abs(b.q - 0.8) < .05, onClick: () => { b.q = 0.8; opts.onChange(i); draw() } },
        { label: 'Moyenne (1.5)', checked: Math.abs(b.q - 1.5) < .05, onClick: () => { b.q = 1.5; opts.onChange(i); draw() } },
        { label: 'Etroite (4)', checked: Math.abs(b.q - 4) < .2, onClick: () => { b.q = 4; opts.onChange(i); draw() } },
        { label: 'Chirurgicale (10)', checked: b.q > 8, onClick: () => { b.q = 10; opts.onChange(i); draw() } },
      ] },
      { label: 'Type', ico: 'wrench', sub: ([
        ['lowshelf', 'Plateau grave'], ['peaking', 'Cloche'], ['highshelf', 'Plateau aigu'],
      ] as [EqBand['type'], string][]).map(([t, l]) => ({
        label: l, checked: b.type === t, onClick: () => { b.type = t; opts.onChange(i); draw() },
      })) },
    ], { title: `${i + 1} · ${BAND_NAMES[i]}` })
  }

  const view: EqView = {
    el, draw,
    setAnalyser(a) {
      analyser = a
      if (a) sampleRate = a.context.sampleRate
      spec = null
    },
    get active() { return grab >= 0 ? grab : hover },
    set active(_v: number) { /* lecture seule */ },
  }
  return view
}
