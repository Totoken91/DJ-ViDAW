/* ============================================================
   DJ ViDAW — PIANO ROLL
   Rendu canvas. Dessin, deplacement, redimensionnement, gomme,
   velocite en bas, defilement molette, zoom Ctrl+molette.
   ============================================================ */

import { h } from './dom'
import { icon } from './icons'
import type { Ctx } from './ctx'
import type { Note } from '../core/state'
import { uid, patternSteps, keyName, isBlack, clamp } from '../core/state'

const KEY_W = 52
const VEL_H = 62

type Mode = 'draw' | 'erase' | 'select'

export class PianoRoll {
  el: HTMLElement
  private cv: HTMLCanvasElement
  private g: CanvasRenderingContext2D
  private host: HTMLElement
  chId: string
  private stepW = 26
  private keyH = 13
  private scrollX = 0
  private scrollY = 0
  private mode: Mode = 'draw'
  private lastLen = 4
  private playStep = -1
  private hoverNote: Note | null = null
  private titleEl: HTMLElement

  private dragState:
    | { kind: 'move'; note: Note; ox: number; oy: number; startT: number; startKey: number }
    | { kind: 'resize'; note: Note; startLen: number; ox: number }
    | { kind: 'vel'; note: Note }
    | { kind: 'paint'; last: number }
    | null = null

  constructor(private ctx: Ctx, chId: string) {
    this.chId = chId
    this.cv = h('canvas')
    this.host = h('div', { class: 'cv-host' }, this.cv)
    this.g = this.cv.getContext('2d')!
    this.titleEl = h('span', { class: 'pill' }, '—')
    this.el = h('div', { class: 'rack' }, this.bar(), this.host)
    this.bind()
    this.scrollY = Math.max(0, (108 - 60) * this.keyH - 120)
    requestAnimationFrame(() => this.resize())
  }

  private bar(): HTMLElement {
    const mk = (m: Mode, ic: string, label: string) => {
      const b = h('button', { class: `btn tiny${this.mode === m ? ' on' : ''}`, onclick: () => {
        this.mode = m
        ;[...b.parentElement!.querySelectorAll('.btn')].forEach((x) => x.classList.remove('on'))
        b.classList.add('on')
      } }, icon(ic), label)
      return b
    }
    return h('div', { class: 'bar thin' },
      h('span', { class: 'wordart', style: { fontSize: '13px' } }, 'PIANO ROLL'),
      this.titleEl,
      h('div', { class: 'sep' }),
      h('div', { style: { display: 'flex', gap: '3px' } }, mk('draw', 'wand', 'DESSIN'), mk('erase', 'broom', 'GOMME')),
      h('div', { class: 'sep' }),
      h('button', { class: 'btn tiny', onclick: () => this.quantize() }, '⌗ QUANTISER'),
      h('button', { class: 'btn tiny', onclick: () => this.transpose(12) }, '▲ OCT'),
      h('button', { class: 'btn tiny', onclick: () => this.transpose(-12) }, '▼ OCT'),
      h('button', { class: 'btn tiny', onclick: () => this.clearCh() }, icon('broom'), 'VIDER'),
      h('button', { class: 'btn tiny', onclick: () => this.arp() }, icon('wand'), 'ARP MAGIQUE'),
      h('div', { class: 'spacer' }),
      h('span', { class: 'hint' }, 'clic=note · glisser bord droit=longueur · molette=defiler · ctrl+molette=zoom'),
    )
  }

  setChannel(id: string) { this.chId = id; this.draw() }

  private pattern() { return this.ctx.project.patterns.find((p) => p.id === this.ctx.project.currentPattern)! }
  private notes(): Note[] { return this.pattern().notes.filter((n) => n.ch === this.chId) }

  resize() {
    const r = this.host.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.cv.width = Math.max(1, Math.floor(r.width * dpr))
    this.cv.height = Math.max(1, Math.floor(r.height * dpr))
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.draw()
  }

  setPlayhead(s: number) { if (s !== this.playStep) { this.playStep = s; this.draw() } }

  /* ---------------- conversions ---------------- */
  private xToStep(x: number) { return (x - KEY_W + this.scrollX) / this.stepW }
  private stepToX(t: number) { return KEY_W + t * this.stepW - this.scrollX }
  private yToKey(y: number) { return 108 - Math.floor((y + this.scrollY) / this.keyH) }
  private keyToY(k: number) { return (108 - k) * this.keyH - this.scrollY }

  /* ---------------- dessin ---------------- */
  draw() {
    const g = this.g
    const W = this.cv.clientWidth || this.host.clientWidth
    const H = this.cv.clientHeight || this.host.clientHeight
    if (W < 4 || H < 4) return
    const gridH = H - VEL_H
    const pat = this.pattern()
    const steps = patternSteps(pat)
    const ch = this.ctx.channel(this.chId)
    this.titleEl.textContent = ch ? ch.name : '—'
    const col = ch?.color ?? '#ff8a3d'

    g.clearRect(0, 0, W, H)
    g.fillStyle = '#1a1a20'; g.fillRect(0, 0, W, H)

    // lignes horizontales (touches)
    for (let k = 108; k >= 12; k--) {
      const y = this.keyToY(k)
      if (y > gridH || y + this.keyH < 0) continue
      g.fillStyle = isBlack(k) ? '#202028' : '#26262f'
      if (k % 12 === 0) g.fillStyle = '#2e2e3a'
      g.fillRect(KEY_W, y, W - KEY_W, this.keyH - 1)
    }

    // lignes verticales (pas)
    for (let t = 0; t <= steps; t++) {
      const x = this.stepToX(t)
      if (x < KEY_W - 2 || x > W) continue
      g.fillStyle = t % 16 === 0 ? '#6d6d84' : t % 4 === 0 ? '#43434f' : '#31313b'
      g.fillRect(Math.round(x), 0, t % 16 === 0 ? 2 : 1, gridH)
    }

    // zone hors motif
    const endX = this.stepToX(steps)
    if (endX < W) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(endX, 0, W - endX, gridH) }

    // notes
    for (const n of this.notes()) {
      const x = this.stepToX(n.t)
      const y = this.keyToY(n.key)
      const w = Math.max(4, n.len * this.stepW - 2)
      if (x > W || x + w < KEY_W || y > gridH || y + this.keyH < 0) continue
      const hh = this.keyH - 2
      const grad = g.createLinearGradient(0, y, 0, y + hh)
      grad.addColorStop(0, '#ffffff')
      grad.addColorStop(0.18, col)
      grad.addColorStop(1, shade(col, -0.45))
      g.fillStyle = grad
      g.fillRect(x, y, w, hh)
      g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineWidth = 1
      g.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1)
      // barre de velocite interne
      g.fillStyle = 'rgba(0,0,0,.4)'
      g.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * (1 - n.vel)), 2)
      if (n === this.hoverNote) { g.strokeStyle = '#fff'; g.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1) }
    }

    // clavier
    g.fillStyle = '#101014'; g.fillRect(0, 0, KEY_W, gridH)
    for (let k = 108; k >= 12; k--) {
      const y = this.keyToY(k)
      if (y > gridH || y + this.keyH < 0) continue
      const black = isBlack(k)
      g.fillStyle = black ? '#191920' : '#e8e8ee'
      g.fillRect(0, y, black ? KEY_W * 0.62 : KEY_W, this.keyH - 1)
      if (!black) {
        g.strokeStyle = '#9a9aa8'; g.lineWidth = 1
        g.strokeRect(0.5, y + 0.5, KEY_W - 1, this.keyH - 2)
      }
      if (k % 12 === 0) {
        g.fillStyle = '#5a5a70'; g.font = '8px Tahoma, sans-serif'
        g.fillText(keyName(k), KEY_W - 22, y + this.keyH - 3)
      }
    }

    // bandeau de velocite
    g.fillStyle = '#141419'; g.fillRect(0, gridH, W, VEL_H)
    g.strokeStyle = '#31313b'; g.beginPath(); g.moveTo(0, gridH + 0.5); g.lineTo(W, gridH + 0.5); g.stroke()
    g.fillStyle = '#6a6a80'; g.font = 'bold 8px Tahoma, sans-serif'
    g.fillText('VELOCITE', 4, gridH + 12)
    for (const n of this.notes()) {
      const x = this.stepToX(n.t) + 1
      if (x > W || x < KEY_W - 8) continue
      const hgt = (VEL_H - 16) * n.vel
      g.fillStyle = col
      g.fillRect(x, gridH + VEL_H - 4 - hgt, Math.max(3, this.stepW - 4), hgt)
      g.fillStyle = '#fff'
      g.fillRect(x, gridH + VEL_H - 4 - hgt, Math.max(3, this.stepW - 4), 2)
    }

    // tete de lecture
    if (this.playStep >= 0) {
      const x = this.stepToX(this.playStep)
      if (x >= KEY_W && x <= W) {
        g.fillStyle = 'rgba(255,255,255,.85)'
        g.fillRect(x, 0, 2, gridH)
        g.fillStyle = 'rgba(255,255,255,.10)'
        g.fillRect(x, 0, this.stepW, gridH)
      }
    }
  }

  /* ---------------- interactions ---------------- */
  private hit(x: number, y: number): { note: Note; edge: boolean } | null {
    const gridH = (this.cv.clientHeight || this.host.clientHeight) - VEL_H
    if (y > gridH) return null
    for (const n of [...this.notes()].reverse()) {
      const nx = this.stepToX(n.t), ny = this.keyToY(n.key)
      const w = Math.max(4, n.len * this.stepW - 2)
      if (x >= nx && x <= nx + w && y >= ny && y <= ny + this.keyH - 2) {
        return { note: n, edge: x > nx + w - 6 }
      }
    }
    return null
  }

  private bind() {
    const cv = this.cv
    const pos = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    cv.addEventListener('contextmenu', (e) => e.preventDefault())

    cv.addEventListener('pointerdown', (e) => {
      const { x, y } = pos(e)
      const H = cv.clientHeight
      const gridH = H - VEL_H
      cv.setPointerCapture(e.pointerId)

      // clavier : preecoute
      if (x < KEY_W && y < gridH) {
        const k = this.yToKey(y)
        void this.ctx.engine.preview(this.chId, k, 4, 0.9)
        return
      }

      // bandeau velocite
      if (y > gridH) {
        const t = Math.floor(this.xToStep(x))
        const n = this.notes().find((nn) => t >= nn.t && t < nn.t + nn.len)
        if (n) {
          this.dragState = { kind: 'vel', note: n }
          n.vel = clamp(1 - (y - gridH - 8) / (VEL_H - 16), 0.05, 1)
          this.ctx.markDirty(); this.draw()
        }
        return
      }

      const hit = this.hit(x, y)
      const erase = this.mode === 'erase' || e.button === 2 || e.altKey

      if (hit && erase) {
        const pat = this.pattern()
        pat.notes = pat.notes.filter((n) => n !== hit.note)
        this.ctx.markDirty(); this.draw()
        this.dragState = { kind: 'paint', last: -1 }
        return
      }
      if (hit && hit.edge) {
        this.dragState = { kind: 'resize', note: hit.note, startLen: hit.note.len, ox: x }
        return
      }
      if (hit) {
        this.dragState = { kind: 'move', note: hit.note, ox: x, oy: y, startT: hit.note.t, startKey: hit.note.key }
        void this.ctx.engine.preview(this.chId, hit.note.key, hit.note.len, hit.note.vel)
        return
      }
      if (erase) { this.dragState = { kind: 'paint', last: -1 }; return }

      // nouvelle note
      const t = Math.max(0, Math.floor(this.xToStep(x)))
      const k = clamp(this.yToKey(y), 12, 108)
      const steps = patternSteps(this.pattern())
      if (t >= steps) return
      const n: Note = { id: uid('n'), ch: this.chId, t, len: this.lastLen, key: k, vel: 0.85, slice: -1 }
      this.pattern().notes.push(n)
      void this.ctx.engine.preview(this.chId, k, n.len, n.vel)
      this.ctx.markDirty()
      this.dragState = { kind: 'resize', note: n, startLen: n.len, ox: x + n.len * this.stepW }
      this.draw()
      this.ctx.refresh('rack')
    })

    cv.addEventListener('pointermove', (e) => {
      const { x, y } = pos(e)
      const st = this.dragState
      if (!st) {
        const hh = this.hit(x, y)
        const nn = hh?.note ?? null
        cv.style.cursor = hh ? (hh.edge ? 'ew-resize' : 'move') : 'crosshair'
        if (nn !== this.hoverNote) { this.hoverNote = nn; this.draw() }
        return
      }
      if (st.kind === 'move') {
        const dt = Math.round((x - st.ox) / this.stepW)
        const dk = -Math.round((y - st.oy) / this.keyH)
        const steps = patternSteps(this.pattern())
        st.note.t = clamp(st.startT + dt, 0, steps - 1)
        st.note.key = clamp(st.startKey + dk, 12, 108)
        this.ctx.markDirty(); this.draw()
      } else if (st.kind === 'resize') {
        const len = Math.max(1, Math.round((x - this.stepToX(st.note.t)) / this.stepW))
        st.note.len = clamp(len, 1, 64)
        this.lastLen = st.note.len
        this.ctx.markDirty(); this.draw()
      } else if (st.kind === 'vel') {
        const gridH = cv.clientHeight - VEL_H
        st.note.vel = clamp(1 - (y - gridH - 8) / (VEL_H - 16), 0.05, 1)
        this.ctx.markDirty(); this.draw()
      } else if (st.kind === 'paint') {
        const hh = this.hit(x, y)
        if (hh) {
          const pat = this.pattern()
          pat.notes = pat.notes.filter((n) => n !== hh.note)
          this.ctx.markDirty(); this.draw()
        }
      }
    })

    const end = () => { if (this.dragState) { this.dragState = null; this.ctx.refresh('rack') } }
    cv.addEventListener('pointerup', end)
    cv.addEventListener('pointercancel', end)

    cv.addEventListener('wheel', (e) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        this.stepW = clamp(this.stepW * (e.deltaY > 0 ? 0.88 : 1.14), 8, 90)
        this.keyH = clamp(this.keyH * (e.deltaY > 0 ? 0.92 : 1.09), 7, 30)
      } else if (e.shiftKey) {
        this.scrollX = Math.max(0, this.scrollX + e.deltaY * 0.8)
      } else {
        this.scrollY = clamp(this.scrollY + e.deltaY * 0.7, 0, 97 * this.keyH)
      }
      this.draw()
    }, { passive: false })
  }

  /* ---------------- outils ---------------- */
  private quantize() {
    for (const n of this.notes()) n.t = Math.round(n.t)
    this.ctx.markDirty(); this.draw(); this.ctx.toast('Quantise. Comme si tu savais jouer.')
  }
  private transpose(d: number) {
    for (const n of this.notes()) n.key = clamp(n.key + d, 12, 108)
    this.ctx.markDirty(); this.draw()
  }
  private clearCh() {
    const pat = this.pattern()
    pat.notes = pat.notes.filter((n) => n.ch !== this.chId)
    this.ctx.markDirty(); this.draw(); this.ctx.refresh('rack')
  }
  private arp() {
    const pat = this.pattern()
    const steps = patternSteps(pat)
    pat.notes = pat.notes.filter((n) => n.ch !== this.chId)
    const scale = [0, 2, 3, 5, 7, 8, 10]         // mineur naturel
    const root = 60
    const shape = [0, 2, 4, 6, 4, 2, 3, 1]
    for (let t = 0; t < steps; t++) {
      const deg = shape[t % shape.length]
      const oct = t % 16 >= 8 ? 12 : 0
      pat.notes.push({
        id: uid('n'), ch: this.chId, t, len: 1,
        key: root + scale[deg % scale.length] + oct, vel: t % 4 === 0 ? 0.95 : 0.6, slice: -1,
      })
    }
    this.ctx.markDirty(); this.draw(); this.ctx.refresh('rack')
    this.ctx.say('Arpege genere. Tu peux dire que tu as fait une conservatoire.')
  }
}

function shade(hex: string, amt: number): string {
  const m = hex.replace('#', '')
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16)
  const r = clamp(((n >> 16) & 255) * (1 + amt), 0, 255)
  const g = clamp(((n >> 8) & 255) * (1 + amt), 0, 255)
  const b = clamp((n & 255) * (1 + amt), 0, 255)
  return `rgb(${r | 0},${g | 0},${b | 0})`
}
