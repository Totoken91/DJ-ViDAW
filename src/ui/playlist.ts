/* ============================================================
   DJ ViDAW — PLAYLIST (arrangement)
   On peint des clips de pattern sur des pistes. Clic = poser,
   clic droit = effacer, glisser = deplacer, bord droit = etirer.
   ============================================================ */

import { h } from './dom'
import { icon } from './icons'
import type { Ctx } from './ctx'
import type { Clip } from '../core/state'
import { uid, patternSteps, clamp, STEPS_PER_BAR } from '../core/state'

const HEAD_W = 74
const TRACKS = 10
const RULER_H = 22

export class Playlist {
  el: HTMLElement
  private cv: HTMLCanvasElement
  private g: CanvasRenderingContext2D
  private host: HTMLElement
  private barW = 46
  private trackH = 30
  private scrollX = 0
  private scrollY = 0
  private playStep = -1
  private brush = 0            // index du pattern a peindre
  private brushSel: HTMLSelectElement
  private drag:
    | { kind: 'move'; clip: Clip; ox: number; oy: number; s0: number; tr0: number }
    | { kind: 'len'; clip: Clip; ox: number; l0: number }
    | { kind: 'erase' }
    | null = null

  constructor(private ctx: Ctx) {
    this.cv = h('canvas')
    this.host = h('div', { class: 'cv-host' }, this.cv)
    this.g = this.cv.getContext('2d')!
    this.brushSel = h('select', { class: 'sel', onchange: (e: Event) => {
      this.brush = (e.target as HTMLSelectElement).selectedIndex
    } })
    this.el = h('div', { class: 'rack' }, this.bar(), this.host)
    this.bind()
    requestAnimationFrame(() => this.resize())
  }

  private bar(): HTMLElement {
    return h('div', { class: 'bar thin' },
      h('div', { class: 'cluster' }, h('span', { class: 'hint' }, 'PINCEAU'), this.brushSel),
      h('div', { class: 'cluster' },
        h('button', { class: 'btn tiny', dataset: { tip: 'Cree un motif vide' }, onclick: () => this.addPattern() }, icon('plus'), 'MOTIF'),
        h('button', { class: 'btn tiny', dataset: { tip: 'Duplique le motif courant (Ctrl+D)' }, onclick: () => this.clonePattern() }, '⧉ CLONER')),
      h('div', { class: 'cluster' },
        h('button', { class: 'btn tiny', dataset: { tip: 'Retire tous les clips de l\'arrangement' }, onclick: () => { this.ctx.project.clips = []; this.ctx.markDirty(); this.draw() } }, icon('broom'), 'VIDER'),
        h('button', { class: 'btn tiny', dataset: { tip: 'Pose une structure de seize mesures avec les motifs existants' }, onclick: () => this.autoArrange() }, icon('wand'), 'ARRANGER AUTO')),
      h('div', { class: 'spacer' }),
    )
  }

  private syncBrush() {
    const sel = this.brushSel
    const cur = sel.selectedIndex
    sel.innerHTML = ''
    this.ctx.project.patterns.forEach((p) => sel.appendChild(h('option', {}, p.name)))
    sel.selectedIndex = clamp(cur < 0 ? 0 : cur, 0, this.ctx.project.patterns.length - 1)
    this.brush = sel.selectedIndex
  }

  private addPattern() {
    const c = this.ctx
    const i = c.project.patterns.length
    const p = { id: uid('pat'), name: `MOTIF ${i + 1}`, color: ['#ff4fa3', '#ffd53d', '#4fe0ff', '#8cff4f', '#c77dff'][i % 5], bars: 1, notes: [] }
    c.project.patterns.push(p)
    c.project.currentPattern = p.id
    c.markDirty(); c.refresh('all')
  }

  /** Duplique le motif courant. Accessible par Ctrl+D. */
  clonePattern() {
    const c = this.ctx
    const src = c.project.patterns.find((p) => p.id === c.project.currentPattern)
    if (!src) return
    const copy = {
      ...src, id: uid('pat'), name: `${src.name} (2)`,
      notes: src.notes.map((n) => ({ ...n, id: uid('n') })),
    }
    c.project.patterns.push(copy)
    c.project.currentPattern = copy.id
    c.markDirty(); c.refresh('all')
    c.toast(`Copie : ${copy.name}`)
  }

  private autoArrange() {
    const c = this.ctx
    const pats = c.project.patterns
    if (!pats.length) return
    c.project.clips = []
    // structure : intro / couplet / drop / break / drop / outro
    const plan = [0, 0, 1 % pats.length, 1 % pats.length, 0, 0, 1 % pats.length, 1 % pats.length]
    plan.forEach((pi, i) => {
      const p = pats[pi]
      const len = patternSteps(p)
      for (let r = 0; r < 2; r++) {
        c.project.clips.push({ id: uid('c'), pat: p.id, track: pi % TRACKS, start: (i * 2 + r) * STEPS_PER_BAR, len })
      }
    })
    c.project.songLenBars = 16
    c.markDirty(); this.draw()
    c.say('Structure pondue en 0.2 seconde. Les vrais producteurs mettent 3 mois.')
  }

  resize() {
    const r = this.host.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.cv.width = Math.max(1, Math.floor(r.width * dpr))
    this.cv.height = Math.max(1, Math.floor(r.height * dpr))
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.draw()
  }

  setPlayhead(s: number) { if (s !== this.playStep) { this.playStep = s; this.draw() } }

  private xToStep(x: number) { return ((x - HEAD_W + this.scrollX) / this.barW) * STEPS_PER_BAR }
  private stepToX(s: number) { return HEAD_W + (s / STEPS_PER_BAR) * this.barW - this.scrollX }
  private yToTrack(y: number) { return Math.floor((y - RULER_H + this.scrollY) / this.trackH) }

  draw() {
    this.syncBrush()
    const g = this.g
    const W = this.cv.clientWidth || this.host.clientWidth
    const H = this.cv.clientHeight || this.host.clientHeight
    if (W < 4 || H < 4) return
    const p = this.ctx.project

    g.clearRect(0, 0, W, H)
    g.fillStyle = '#1b1b21'; g.fillRect(0, 0, W, H)

    const bars = Math.ceil((W - HEAD_W + this.scrollX) / this.barW) + 1
    const bar0 = Math.floor(this.scrollX / this.barW)

    // pistes
    for (let t = 0; t < TRACKS; t++) {
      const y = RULER_H + t * this.trackH - this.scrollY
      if (y > H) break
      if (y + this.trackH < RULER_H) continue
      g.fillStyle = t % 2 ? '#20202a' : '#1d1d25'
      g.fillRect(HEAD_W, y, W - HEAD_W, this.trackH - 1)
    }
    // grille verticale
    for (let b = bar0; b < bar0 + bars; b++) {
      const x = HEAD_W + b * this.barW - this.scrollX
      if (x < HEAD_W) continue
      g.fillStyle = b % 4 === 0 ? '#5b5b72' : '#2f2f3b'
      g.fillRect(Math.round(x), RULER_H, b % 4 === 0 ? 2 : 1, H - RULER_H)
    }

    // clips
    for (const c of p.clips) {
      const pat = p.patterns.find((x) => x.id === c.pat)
      if (!pat) continue
      const x = this.stepToX(c.start)
      const w = (c.len / STEPS_PER_BAR) * this.barW - 2
      const y = RULER_H + c.track * this.trackH + 2 - this.scrollY
      if (x > W || x + w < HEAD_W || y + this.trackH < RULER_H || y > H) continue
      const hh = this.trackH - 6
      const grad = g.createLinearGradient(0, y, 0, y + hh)
      grad.addColorStop(0, '#ffffff')
      grad.addColorStop(0.16, pat.color)
      grad.addColorStop(1, 'rgba(0,0,0,.55)')
      g.fillStyle = grad
      g.fillRect(x, y, w, hh)
      g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1)
      // apercu des notes dans le clip
      const patLen = patternSteps(pat)
      g.fillStyle = 'rgba(0,0,0,.5)'
      for (const n of pat.notes) {
        const nx = x + ((n.t % patLen) / patLen) * w
        const ny = y + hh - 3 - ((n.key - 36) / 60) * (hh - 6)
        if (nx > x && nx < x + w) g.fillRect(nx, clamp(ny, y + 1, y + hh - 3), 2, 2)
      }
      g.fillStyle = '#000'; g.font = 'bold 9px Tahoma, sans-serif'
      if (w > 34) g.fillText(pat.name.slice(0, Math.floor(w / 6)), x + 4, y + 11)
    }

    // regle
    g.fillStyle = '#2c2c36'; g.fillRect(0, 0, W, RULER_H)
    g.strokeStyle = '#14141a'; g.beginPath(); g.moveTo(0, RULER_H - .5); g.lineTo(W, RULER_H - .5); g.stroke()
    g.font = 'bold 9px Tahoma, sans-serif'
    for (let b = bar0; b < bar0 + bars; b++) {
      const x = HEAD_W + b * this.barW - this.scrollX
      if (x < HEAD_W) continue
      g.fillStyle = b % 4 === 0 ? '#e6e9f2' : '#7a7a90'
      g.fillRect(x, RULER_H - (b % 4 === 0 ? 9 : 5), 1, b % 4 === 0 ? 9 : 5)
      if (b % 4 === 0) g.fillText(String(b + 1), x + 3, 11)
    }

    // en-tetes de piste
    g.fillStyle = '#26262f'; g.fillRect(0, RULER_H, HEAD_W, H - RULER_H)
    for (let t = 0; t < TRACKS; t++) {
      const y = RULER_H + t * this.trackH - this.scrollY
      if (y > H) break
      if (y + this.trackH < RULER_H) continue
      g.strokeStyle = '#14141a'
      g.beginPath(); g.moveTo(0, y + this.trackH - .5); g.lineTo(HEAD_W, y + this.trackH - .5); g.stroke()
      g.fillStyle = '#9aa0b0'; g.font = 'bold 9px Tahoma, sans-serif'
      g.fillText(`PISTE ${t + 1}`, 8, y + this.trackH / 2 + 3)
    }
    g.fillStyle = '#1b1b21'; g.fillRect(0, 0, HEAD_W, RULER_H)
    g.fillStyle = '#00ff9c'; g.font = 'bold 10px Tahoma, sans-serif'
    g.fillText('MESURE', 8, 14)

    // tete de lecture
    if (this.playStep >= 0) {
      const x = this.stepToX(this.playStep)
      if (x >= HEAD_W && x <= W) {
        g.fillStyle = '#fff'; g.fillRect(x, 0, 2, H)
        g.fillStyle = 'rgba(255,255,255,.9)'
        g.beginPath(); g.moveTo(x - 5, 0); g.lineTo(x + 7, 0); g.lineTo(x + 1, 8); g.fill()
      }
    }
  }

  private hit(x: number, y: number): { clip: Clip; edge: boolean } | null {
    const tr = this.yToTrack(y)
    for (const c of [...this.ctx.project.clips].reverse()) {
      if (c.track !== tr) continue
      const cx = this.stepToX(c.start)
      const w = (c.len / STEPS_PER_BAR) * this.barW - 2
      if (x >= cx && x <= cx + w) return { clip: c, edge: x > cx + w - 7 }
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
      cv.setPointerCapture(e.pointerId)
      if (y < RULER_H) {
        const s = Math.max(0, Math.round(this.xToStep(x) / STEPS_PER_BAR) * STEPS_PER_BAR)
        this.ctx.engine.seek(s)
        this.setPlayhead(s)
        return
      }
      if (x < HEAD_W) return
      const hit = this.hit(x, y)
      const erase = e.button === 2 || e.altKey

      if (hit && erase) {
        this.ctx.project.clips = this.ctx.project.clips.filter((c) => c !== hit.clip)
        this.ctx.markDirty(); this.draw()
        this.drag = { kind: 'erase' }
        return
      }
      if (erase) { this.drag = { kind: 'erase' }; return }
      if (hit && hit.edge) { this.drag = { kind: 'len', clip: hit.clip, ox: x, l0: hit.clip.len }; return }
      if (hit) {
        this.drag = { kind: 'move', clip: hit.clip, ox: x, oy: y, s0: hit.clip.start, tr0: hit.clip.track }
        this.ctx.project.currentPattern = hit.clip.pat
        this.ctx.refresh('all')
        return
      }
      // poser un clip
      const pats = this.ctx.project.patterns
      const pat = pats[clamp(this.brush, 0, pats.length - 1)]
      if (!pat) return
      const tr = clamp(this.yToTrack(y), 0, TRACKS - 1)
      const start = Math.max(0, Math.round(this.xToStep(x) / STEPS_PER_BAR) * STEPS_PER_BAR)
      const clip: Clip = { id: uid('c'), pat: pat.id, track: tr, start, len: patternSteps(pat) }
      this.ctx.project.clips.push(clip)
      this.ctx.markDirty()
      this.drag = { kind: 'move', clip, ox: x, oy: y, s0: start, tr0: tr }
      this.draw()
    })

    cv.addEventListener('pointermove', (e) => {
      const { x, y } = pos(e)
      const d = this.drag
      if (!d) {
        const hh = this.hit(x, y)
        cv.style.cursor = y < RULER_H ? 'col-resize' : hh ? (hh.edge ? 'ew-resize' : 'move') : 'crosshair'
        return
      }
      if (d.kind === 'move') {
        const ds = Math.round(((x - d.ox) / this.barW) * STEPS_PER_BAR / STEPS_PER_BAR) * STEPS_PER_BAR
        const dt = Math.round((y - d.oy) / this.trackH)
        d.clip.start = Math.max(0, d.s0 + ds)
        d.clip.track = clamp(d.tr0 + dt, 0, TRACKS - 1)
        this.ctx.markDirty(); this.draw()
      } else if (d.kind === 'len') {
        const dl = Math.round(((x - d.ox) / this.barW) * STEPS_PER_BAR / STEPS_PER_BAR) * STEPS_PER_BAR
        d.clip.len = Math.max(STEPS_PER_BAR, d.l0 + dl)
        this.ctx.markDirty(); this.draw()
      } else if (d.kind === 'erase') {
        const hh = this.hit(x, y)
        if (hh) {
          this.ctx.project.clips = this.ctx.project.clips.filter((c) => c !== hh.clip)
          this.ctx.markDirty(); this.draw()
        }
      }
    })

    const end = () => { this.drag = null }
    cv.addEventListener('pointerup', end)
    cv.addEventListener('pointercancel', end)

    cv.addEventListener('wheel', (e) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) this.barW = clamp(this.barW * (e.deltaY > 0 ? 0.88 : 1.14), 14, 220)
      else if (e.shiftKey) this.scrollY = clamp(this.scrollY + e.deltaY * 0.7, 0, Math.max(0, TRACKS * this.trackH - 60))
      else this.scrollX = Math.max(0, this.scrollX + e.deltaY * 1.1)
      this.draw()
    }, { passive: false })
  }
}
