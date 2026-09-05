/* ============================================================
   DJ ViDAW — POTARDS ET FADERS
   Un vrai potard FL Studio : on tire vers le haut, shift = precis,
   double-clic = valeur par defaut, molette supportee.
   ============================================================ */

import { h, drag } from './dom'
import { clamp } from '../core/state'

export interface KnobOpts {
  min: number
  max: number
  value: number
  def?: number
  label?: string
  size?: number
  unit?: string
  curve?: number             // 1 = lineaire, >1 = plus fin en bas (frequences)
  format?: (v: number) => string
  onInput: (v: number) => void
  color?: string
}

export function knob(o: KnobOpts): HTMLElement {
  const size = o.size ?? 34
  const curve = o.curve ?? 1
  const def = o.def ?? o.value
  let value = clamp(o.value, o.min, o.max)

  const norm = (v: number) => Math.pow((v - o.min) / (o.max - o.min || 1), 1 / curve)
  const denorm = (n: number) => o.min + Math.pow(clamp(n, 0, 1), curve) * (o.max - o.min)

  const cv = h('canvas', { class: 'knob-cv', width: String(size * 2), height: String(size * 2) })
  cv.style.width = `${size}px`
  cv.style.height = `${size}px`
  const readout = h('div', { class: 'knob-val' })
  const wrap = h('div', { class: 'knob' },
    cv,
    o.label ? h('div', { class: 'knob-label' }, o.label) : null,
    readout,
  )

  const fmtV = o.format ?? ((v: number) => {
    const a = Math.abs(v)
    const s = a >= 1000 ? `${(v / 1000).toFixed(1)}k` : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2)
    return s + (o.unit ?? '')
  })

  const ctx = cv.getContext('2d')!
  function paint() {
    const n = norm(value)
    const s = size * 2
    const r = s * 0.36
    const cx = s / 2, cy = s / 2
    ctx.clearRect(0, 0, s, s)

    // corps metal brosse Y2K
    const grad = ctx.createLinearGradient(0, 0, 0, s)
    grad.addColorStop(0, '#f6f6f8')
    grad.addColorStop(0.42, '#b9bcc6')
    grad.addColorStop(0.5, '#8d919d')
    grad.addColorStop(0.58, '#c8cbd4')
    grad.addColorStop(1, '#5f6470')
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = grad; ctx.fill()
    ctx.lineWidth = 2; ctx.strokeStyle = '#20232b'; ctx.stroke()

    // rail
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25
    ctx.beginPath(); ctx.arc(cx, cy, r + s * 0.11, a0, a1)
    ctx.lineWidth = s * 0.09; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineCap = 'round'; ctx.stroke()

    // arc de valeur
    ctx.beginPath(); ctx.arc(cx, cy, r + s * 0.11, a0, a0 + (a1 - a0) * n)
    ctx.strokeStyle = o.color ?? '#00ff9c'
    ctx.lineWidth = s * 0.075
    ctx.shadowColor = o.color ?? '#00ff9c'
    ctx.shadowBlur = s * 0.12
    ctx.stroke()
    ctx.shadowBlur = 0

    // aiguille
    const ang = a0 + (a1 - a0) * n
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(ang) * r * 0.28, cy + Math.sin(ang) * r * 0.28)
    ctx.lineTo(cx + Math.cos(ang) * r * 0.92, cy + Math.sin(ang) * r * 0.92)
    ctx.strokeStyle = '#12141a'; ctx.lineWidth = s * 0.055; ctx.lineCap = 'round'; ctx.stroke()

    // reflet
    ctx.beginPath()
    ctx.ellipse(cx - r * 0.28, cy - r * 0.36, r * 0.42, r * 0.2, -0.5, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill()

    readout.textContent = fmtV(value)
  }

  function set(v: number, fire = true) {
    value = clamp(v, o.min, o.max)
    paint()
    if (fire) o.onInput(value)
  }

  let start = 0
  drag(wrap, (_dx, dy, e) => {
    const fine = e.shiftKey ? 0.22 : 1
    set(denorm(start - (dy / 170) * fine))
  }, () => { start = norm(value); wrap.classList.add('grabbing') },
     () => wrap.classList.remove('grabbing'))

  wrap.addEventListener('dblclick', () => set(def))
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault()
    const fine = e.shiftKey ? 0.01 : 0.035
    set(denorm(norm(value) - Math.sign(e.deltaY) * fine))
  }, { passive: false })

  paint()
  ;(wrap as HTMLElement & { setValue?: (v: number) => void }).setValue = (v: number) => set(v, false)
  return wrap
}

/* ---------------- Fader vertical (mixeur) ---------------- */

export function fader(o: {
  min: number; max: number; value: number; height?: number
  onInput: (v: number) => void; color?: string
}): HTMLElement {
  const H = o.height ?? 120
  let value = clamp(o.value, o.min, o.max)
  const cap = h('div', { class: 'fader-cap' })
  const fill = h('div', { class: 'fader-fill' })
  const track = h('div', { class: 'fader-track' }, fill, cap)
  const wrap = h('div', { class: 'fader' }, track)
  track.style.height = `${H}px`
  if (o.color) fill.style.background = o.color

  const paint = () => {
    const n = (value - o.min) / (o.max - o.min || 1)
    cap.style.bottom = `${n * (H - 18)}px`
    fill.style.height = `${n * 100}%`
  }
  const set = (v: number) => { value = clamp(v, o.min, o.max); paint(); o.onInput(value) }

  let start = 0
  drag(track, (_dx, dy) => set(start - (dy / (H - 18)) * (o.max - o.min)),
    () => { start = value })
  track.addEventListener('wheel', (e) => {
    e.preventDefault()
    set(value - Math.sign(e.deltaY) * (o.max - o.min) * 0.04)
  }, { passive: false })

  paint()
  ;(wrap as HTMLElement & { setValue?: (v: number) => void }).setValue = (v: number) => {
    value = clamp(v, o.min, o.max); paint()
  }
  return wrap
}

/* ---------------- Vu-metre ---------------- */

export function meter(analyser: AnalyserNode | null, w = 10, hgt = 120): { el: HTMLElement; tick: () => void } {
  const cv = h('canvas', { class: 'meter', width: String(w * 2), height: String(hgt * 2) })
  cv.style.width = `${w}px`; cv.style.height = `${hgt}px`
  const ctx = cv.getContext('2d')!
  const data = new Uint8Array(analyser ? analyser.fftSize : 128)
  let peak = 0
  return {
    el: cv,
    tick() {
      const W = w * 2, H = hgt * 2
      let rms = 0
      if (analyser) {
        analyser.getByteTimeDomainData(data)
        for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; rms += v * v }
        rms = Math.sqrt(rms / data.length)
      }
      const lvl = Math.min(1, Math.pow(rms * 2.4, 0.65))
      peak = Math.max(lvl, peak - 0.012)
      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = '#0a0d10'; ctx.fillRect(0, 0, W, H)
      const segs = 24
      for (let i = 0; i < segs; i++) {
        const n = i / segs
        if (n > lvl) { ctx.fillStyle = 'rgba(255,255,255,.05)' }
        else ctx.fillStyle = n > 0.86 ? '#ff2e4d' : n > 0.66 ? '#ffd23d' : '#31ff87'
        const y = H - (i + 1) * (H / segs) + 2
        ctx.fillRect(1, y, W - 2, H / segs - 3)
      }
      if (peak > 0.02) {
        ctx.fillStyle = peak > 0.94 ? '#ff2e4d' : '#ffffff'
        ctx.fillRect(0, H - peak * H - 2, W, 3)
      }
    },
  }
}
