/* ============================================================
   DJ ViDAW — PIANO ROLL
   Rendu canvas. Dessin, deplacement, redimensionnement, gomme,
   velocite en bas, defilement molette, zoom Ctrl+molette.
   ============================================================ */

import { h } from './dom'
import { icon } from './icons'
import { contextMenu, type MenuItem } from './menu'
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
  private keyH = 15
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
    | { kind: 'paint'; last: number; pending: Note | null }
    | { kind: 'pan'; x0: number; y0: number; sx: number; sy: number }
    | null = null
  /** Vrai des que la souris a bouge pendant le geste : sert a distinguer
      un clic droit (menu) d'un glisser droit (gomme). */
  private moved = false

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
      this.titleEl,
      h('div', { class: 'sep' }),
      h('div', { class: 'cluster' }, mk('draw', 'wand', 'DESSIN'), mk('erase', 'broom', 'GOMME')),
      h('div', { class: 'cluster' },
        h('button', { class: 'btn tiny', dataset: { tip: 'Recale toutes les notes sur la grille' }, onclick: () => this.quantize() }, '⌗ QUANTISER'),
        h('button', { class: 'btn tiny', dataset: { tip: 'Monte tout d\'une octave' }, onclick: () => this.transpose(12) }, '▲ OCT'),
        h('button', { class: 'btn tiny', dataset: { tip: 'Descend tout d\'une octave' }, onclick: () => this.transpose(-12) }, '▼ OCT')),
      h('div', { class: 'cluster' },
        h('button', { class: 'btn tiny', dataset: { tip: 'Efface les notes de ce channel' }, onclick: () => this.clearCh() }, icon('broom'), 'VIDER'),
        h('button', { class: 'btn tiny', dataset: { tip: 'Genere un arpege en mineur sur tout le motif' }, onclick: () => this.arp() }, icon('wand'), 'ARP')),
      h('div', { class: 'spacer' }),
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
    g.fillStyle = '#1d212a'; g.fillRect(0, 0, W, H)

    // lignes horizontales (touches)
    for (let k = 108; k >= 12; k--) {
      const y = this.keyToY(k)
      if (y > gridH || y + this.keyH < 0) continue
      // l'ecart entre touches noires et blanches doit se voir : c'est le
      // seul repere vertical quand on lit une melodie
      g.fillStyle = isBlack(k) ? '#191d25' : '#2c323e'
      if (k % 12 === 0) g.fillStyle = '#3a4353'
      g.fillRect(KEY_W, y, W - KEY_W, this.keyH - 1)
    }

    // lignes verticales (pas)
    for (let t = 0; t <= steps; t++) {
      const x = this.stepToX(t)
      if (x < KEY_W - 2 || x > W) continue
      g.fillStyle = t % 16 === 0 ? 'rgba(255,255,255,.34)' : t % 4 === 0 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.06)'
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
      // La velocite joue sur la luminosite, pas sur le blanc ajoute :
      // melanger vers le blanc desature et efface l'identite du channel.
      const body = shade(col, -0.34 + n.vel * 0.5)
      const grad = g.createLinearGradient(0, y, 0, y + hh)
      grad.addColorStop(0, mix(body, '#ffffff', 0.5))
      grad.addColorStop(0.12, body)
      grad.addColorStop(1, shade(body, -0.42))
      g.fillStyle = grad
      g.fillRect(x, y, w, hh)
      g.strokeStyle = 'rgba(0,0,0,.85)'; g.lineWidth = 1
      g.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1)
      // la longueur de la reglette basse redit la velocite
      g.fillStyle = 'rgba(255,255,255,.55)'
      g.fillRect(x + 1.5, y + hh - 3, Math.max(1, (w - 3) * n.vel), 1.5)
      if (n === this.hoverNote) {
        g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 1.5
        g.strokeRect(x + 0.75, y + 0.75, w - 1.5, hh - 1.5)
      }
    }

    // clavier
    g.fillStyle = '#14171e'; g.fillRect(0, 0, KEY_W, gridH)
    for (let k = 108; k >= 12; k--) {
      const y = this.keyToY(k)
      if (y > gridH || y + this.keyH < 0) continue
      const black = isBlack(k)
      g.fillStyle = black ? '#1b1f27' : '#e6e9ef'
      g.fillRect(0, y, black ? KEY_W * 0.62 : KEY_W, this.keyH - 1)
      if (!black) {
        g.strokeStyle = '#8f97a6'; g.lineWidth = 1
        g.strokeRect(0.5, y + 0.5, KEY_W - 1, this.keyH - 2)
      }
      if (k % 12 === 0) {
        g.fillStyle = '#6d778b'; g.font = '8px Tahoma, sans-serif'
        g.fillText(keyName(k), KEY_W - 22, y + this.keyH - 3)
      }
    }

    // bandeau de velocite
    g.fillStyle = '#171a21'; g.fillRect(0, gridH, W, VEL_H)
    g.strokeStyle = '#313743'; g.beginPath(); g.moveTo(0, gridH + 0.5); g.lineTo(W, gridH + 0.5); g.stroke()
    g.fillStyle = '#6d778b'; g.font = 'bold 8px Tahoma, sans-serif'
    g.fillText('VELOCITE', 4, gridH + 12)
    for (const n of this.notes()) {
      const x = this.stepToX(n.t) + 1
      if (x > W || x < KEY_W - 8) continue
      const hgt = (VEL_H - 16) * n.vel
      const bw = Math.max(3, this.stepW - 4)
      g.fillStyle = 'rgba(255,255,255,.05)'
      g.fillRect(x, gridH + 14, bw, VEL_H - 18)
      g.fillStyle = mix(col, '#ffffff', 0.1 + n.vel * 0.25)
      g.fillRect(x, gridH + VEL_H - 4 - hgt, bw, hgt)
      g.fillStyle = 'rgba(255,255,255,.85)'
      g.fillRect(x, gridH + VEL_H - 4 - hgt, bw, 2)
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

    // Le clic droit est un outil (gomme) : le menu systeme n'apparait jamais.
    // Notre menu, lui, s'ouvre au relachement d'un clic droit immobile.
    cv.addEventListener('contextmenu', (e) => e.preventDefault())
    cv.addEventListener('pointerup', (e) => {
      if (e.button !== 2 || this.moved) return
      const { x, y } = pos(e)
      const hit = y <= cv.clientHeight - VEL_H ? this.hit(x, y) : null
      this.rollMenu(e, hit?.note ?? null)
    })

    cv.addEventListener('pointerdown', (e) => {
      const { x, y } = pos(e)
      const H = cv.clientHeight
      const gridH = H - VEL_H
      this.moved = false
      cv.setPointerCapture(e.pointerId)

      // Clic milieu : on deplace la vue. Indispensable des qu'on zoome.
      if (e.button === 1) {
        e.preventDefault()
        this.dragState = { kind: 'pan', x0: x, y0: y, sx: this.scrollX, sy: this.scrollY }
        cv.style.cursor = 'grabbing'
        return
      }

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
        // On ne supprime pas tout de suite : si la souris ne bouge pas,
        // c'est un clic droit, et il ouvre le menu de la note.
        if (e.button === 2) { this.dragState = { kind: 'paint', last: -1, pending: hit.note }; return }
        const pat = this.pattern()
        pat.notes = pat.notes.filter((n) => n !== hit.note)
        this.ctx.markDirty(); this.draw()
        this.dragState = { kind: 'paint', last: -1, pending: null }
        return
      }
      if (hit && hit.edge) {
        this.dragState = { kind: 'resize', note: hit.note, startLen: hit.note.len, ox: x }
        return
      }
      if (hit) {
        // Maj + glisser duplique la note plutot que de la deplacer.
        let note = hit.note
        if (e.shiftKey) {
          note = { ...hit.note, id: uid('n') }
          this.pattern().notes.push(note)
        }
        this.dragState = { kind: 'move', note, ox: x, oy: y, startT: note.t, startKey: note.key }
        void this.ctx.engine.preview(this.chId, note.key, note.len, note.vel)
        return
      }
      if (erase) { this.dragState = { kind: 'paint', last: -1, pending: null }; return }

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
      if (e.buttons) this.moved = true
      if (st?.kind === 'pan') {
        this.scrollX = Math.max(0, st.sx - (x - st.x0))
        this.scrollY = clamp(st.sy - (y - st.y0), 0, 97 * this.keyH)
        this.draw()
        return
      }
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
        const pat = this.pattern()
        // la note d'origine part des que le geste devient un glisser
        if (st.pending) { pat.notes = pat.notes.filter((n) => n !== st.pending); st.pending = null }
        const hh = this.hit(x, y)
        if (hh) pat.notes = pat.notes.filter((n) => n !== hh.note)
        this.ctx.markDirty(); this.draw()
      }
    })

    const end = () => {
      if (!this.dragState) return
      this.dragState = null
      cv.style.cursor = 'crosshair'
      this.ctx.refresh('rack')
    }
    cv.addEventListener('pointerup', end)
    cv.addEventListener('pointercancel', end)

    // Suppr / Retour arriere efface la note sous le curseur : c'est le
    // geste le plus rapide quand on relit un motif a la souris.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (!this.el.isConnected || !this.el.offsetParent || !this.hoverNote) return
      const t = e.target as HTMLElement
      if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return
      e.preventDefault()
      const pat = this.pattern()
      pat.notes = pat.notes.filter((n) => n !== this.hoverNote)
      this.hoverNote = null
      this.ctx.markDirty(); this.draw(); this.ctx.refresh('rack')
    })

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

  /* ---------------- menu contextuel ---------------- */

  /** Clic droit immobile : sur une note, ses reglages ; sinon, les outils
      du piano roll. Le clic droit maintenu, lui, reste la gomme. */
  private rollMenu(ev: MouseEvent, note: Note | null) {
    const c = this.ctx
    const pat = this.pattern()
    const items: MenuItem[] = note ? [
      { label: 'Supprimer la note', ico: 'trash', danger: true, accel: 'Suppr', onClick: () => {
        pat.notes = pat.notes.filter((n) => n !== note)
        c.markDirty(); this.draw(); c.refresh('rack')
      } },
      { label: 'Dupliquer', ico: 'newdoc', accel: 'Maj+glisser', onClick: () => {
        pat.notes.push({ ...note, id: uid('n'), t: note.t + note.len })
        c.markDirty(); this.draw(); c.refresh('rack')
      } },
      '-',
      { label: 'Longueur', ico: 'wave', sub: [1, 2, 4, 8, 16].map((l) => ({
        label: l === 1 ? '1 pas' : `${l} pas`, checked: note.len === l,
        onClick: () => { note.len = l; this.lastLen = l; c.markDirty(); this.draw() },
      })) },
      { label: 'Velocite', sub: [
        { label: 'Douce (40)', onClick: () => { note.vel = 0.31; c.markDirty(); this.draw() } },
        { label: 'Normale (85)', onClick: () => { note.vel = 0.67; c.markDirty(); this.draw() } },
        { label: 'Forte (127)', onClick: () => { note.vel = 1; c.markDirty(); this.draw() } },
      ] },
      { label: 'Ecouter', ico: 'play', onClick: () => void c.engine.preview(this.chId, note.key, note.len, note.vel) },
    ] : [
      { label: 'Quantiser', ico: 'wand', onClick: () => this.quantize() },
      { label: 'Arpege automatique', ico: 'wand', onClick: () => this.arp() },
      '-',
      { label: 'Transposer', ico: 'piano', sub: [
        { label: '+ 1 octave', onClick: () => this.transpose(12) },
        { label: '+ 1 demi-ton', onClick: () => this.transpose(1) },
        { label: '− 1 demi-ton', onClick: () => this.transpose(-1) },
        { label: '− 1 octave', onClick: () => this.transpose(-12) },
      ] },
      { label: 'Longueur par defaut', sub: [1, 2, 4, 8, 16].map((l) => ({
        label: l === 1 ? '1 pas' : `${l} pas`, checked: this.lastLen === l,
        onClick: () => { this.lastLen = l },
      })) },
      '-',
      { label: 'Recentrer la vue', ico: 'screen', accel: 'clic milieu', onClick: () => {
        this.scrollX = 0
        this.scrollY = Math.max(0, (108 - 60) * this.keyH - 120)
        this.draw()
      } },
      { label: 'Vider ce channel', ico: 'broom', danger: true, onClick: () => this.clearCh() },
    ]
    contextMenu(ev, items, { title: note ? keyName(note.key) : (c.channel(this.chId)?.name ?? 'Piano roll') })
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

/** Melange deux couleurs, pour eclaircir une note selon sa velocite. */
function mix(a: string, b: string, t: number): string {
  const rgb = (h: string) => {
    const m = h.replace('#', '')
    const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b)
  const k = clamp(t, 0, 1)
  return `rgb(${Math.round(r1 + (r2 - r1) * k)},${Math.round(g1 + (g2 - g1) * k)},${Math.round(b1 + (b2 - b1) * k)})`
}

function shade(hex: string, amt: number): string {
  const m = hex.replace('#', '').replace(/^rgb\((\d+),(\d+),(\d+)\)$/, '')
  if (hex.startsWith('rgb')) {
    const [r, g, b] = hex.match(/\d+/g)!.map(Number)
    return `rgb(${clamp(r * (1 + amt), 0, 255) | 0},${clamp(g * (1 + amt), 0, 255) | 0},${clamp(b * (1 + amt), 0, 255) | 0})`
  }
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16)
  const r = clamp(((n >> 16) & 255) * (1 + amt), 0, 255)
  const g = clamp(((n >> 8) & 255) * (1 + amt), 0, 255)
  const b = clamp((n & 255) * (1 + amt), 0, 255)
  return `rgb(${r | 0},${g | 0},${b | 0})`
}
