/* ============================================================
   DJ ViDAW — FACE AVANT DU SYNTHETISEUR
   Navigateur de presets, deux oscillateurs, filtre, enveloppes
   dessinees, LFO, effets, et un clavier jouable a la souris comme
   au clavier d'ordinateur.
   ============================================================ */

import { h, clear } from './dom'
import { icon } from './icons'
import { knob } from './knob'
import type { Ctx } from './ctx'
import type { Channel } from '../core/state'
import { clamp, keyName, isBlack } from '../core/state'
import {
  WAVES, WAVE_LABEL, FILTER_LABEL, LFO_LABEL, LFO_DIV_LABELS, DLY_DIV_LABELS,
  type SynthParams, type OscParams, type Env, type Lfo, type Wave, type FilterKind, type LfoShape,
} from '../audio/synth'
import { PRESETS, FAMILIES, loadPreset, type Family } from '../audio/presets'

const WAVE_ICON: Record<Wave, string> = {
  saw: 'wsaw', square: 'wsquare', pulse: 'wpulse', triangle: 'wtri', sine: 'wsine', noise: 'wnoise',
}
const LFO_ICON: Record<LfoShape, string> = {
  sine: 'wsine', tri: 'wtri', saw: 'wramp', square: 'wsquare', sh: 'wsh',
}

/* Le clavier d'ordinateur, par caractere produit : couvre AZERTY et QWERTY. */
const KEYMAP: Record<string, number> = {
  q: 0, a: 0, z: 1, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7,
  y: 8, h: 9, u: 10, j: 11, k: 12, l: 14, m: 16, 'ù': 17,
}

export class SynthPanel {
  el: HTMLElement
  private scroll: HTMLElement
  private ch: Channel
  private preset = -1
  private fam: Family = 'BASSES'
  private octave = 4
  private held = new Map<number, number>()   // note midi -> fin programmee
  private keyEls = new Map<number, HTMLElement>()
  private ampCv!: HTMLCanvasElement
  private filtCv!: HTMLCanvasElement
  private curveCv!: HTMLCanvasElement
  private lcdName!: HTMLElement
  private lcdNote!: HTMLElement
  private listEl!: HTMLElement
  private kbOn = true
  private kbHost!: HTMLElement
  private onKey: ((e: KeyboardEvent) => void) | null = null

  constructor(private ctx: Ctx, ch: Channel) {
    this.ch = ch
    this.scroll = h('div', { class: 'syn-scroll' })
    // le clavier vit dans un hote stable : le recreer a chaque rendu
    // en empilerait un nouveau a chaque fois
    this.kbHost = h('div', { class: 'syn-kbhost' })
    this.el = h('div', { class: 'syn' }, this.scroll, this.kbHost)
    this.render()
    this.bindKeyboard()
  }

  setChannel(ch: Channel) { this.ch = ch; this.preset = -1; this.render() }
  private p(): SynthParams { return this.ch.synth! }

  dispose() {
    if (this.onKey) { window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.upKey) }
  }

  /* ================= rendu ================= */

  render() {
    clear(this.scroll)
    const p = this.p()
    this.scroll.append(
      this.browser(),
      h('div', { class: 'syn-row' }, this.oscSec('A', p.oscA), this.oscSec('B', p.oscB)),
      h('div', { class: 'syn-row' }, this.mixSec(), this.filterSec()),
      h('div', { class: 'syn-row' }, this.envSec('AMPLITUDE', p.ampEnv, '#ffbe4d'), this.envSec('FILTRE', p.filtEnv, '#5fe6ff')),
      h('div', { class: 'syn-row' }, this.lfoSec(1, p.lfo1), this.lfoSec(2, p.lfo2)),
      h('div', { class: 'syn-row' }, this.voiceSec(), this.fxSec()),
    )
    this.rebuildKeys()
    this.paintCurves()
  }

  private touched() {
    this.ctx.markDirty()
    this.ctx.sync()
    this.paintCurves()
  }

  /* ---------------- navigateur de presets ---------------- */

  private browser(): HTMLElement {
    this.lcdName = h('b', {}, this.preset >= 0 ? PRESETS[this.preset].name : 'REGLAGE LIBRE')
    this.lcdNote = h('i', {}, this.preset >= 0 ? PRESETS[this.preset].note : 'aucun preset charge')
    this.listEl = h('div', { class: 'syn-list' })

    const fams = h('div', { class: 'syn-fams' },
      ...FAMILIES.map((f) => h('button', {
        class: `syn-fam${f === this.fam ? ' on' : ''}`,
        onclick: () => { this.fam = f; this.render() },
      }, f)))

    const step = (d: number) => {
      const list = PRESETS.map((_, i) => i)
      const cur = this.preset < 0 ? -1 : this.preset
      this.apply(clamp(cur + d, 0, list.length - 1))
    }

    const bar = h('div', { class: 'syn-browser' },
      h('div', { class: 'syn-lcd' }, this.lcdName, this.lcdNote),
      h('div', { class: 'syn-col' },
        h('div', { style: { display: 'flex', gap: '3px' } },
          h('button', { class: 'syn-pick', title: 'Preset precedent', onclick: () => step(-1) }, '◀'),
          h('button', { class: 'syn-pick', title: 'Preset suivant', onclick: () => step(1) }, '▶'),
          h('button', {
            class: 'syn-pick', title: 'Au hasard',
            onclick: () => this.apply(Math.floor(Math.random() * PRESETS.length)),
          }, icon('dice', 12)),
        ),
        h('button', {
          class: 'syn-pick', title: 'Ecouter',
          onclick: () => void this.ctx.engine.preview(this.ch.id, 60 + (this.octave - 4) * 12, 8, 0.9),
        }, icon('play', 12), ' TESTER'),
      ),
      fams,
      this.listEl,
    )
    this.fillList()
    return bar
  }

  private fillList() {
    clear(this.listEl)
    PRESETS.forEach((pr, i) => {
      if (pr.fam !== this.fam) return
      this.listEl.appendChild(h('div', {
        class: `syn-item${i === this.preset ? ' on' : ''}`,
        onclick: () => this.apply(i),
      }, pr.name))
    })
  }

  private apply(i: number) {
    this.ch.synth = loadPreset(i)
    this.preset = i
    this.fam = PRESETS[i].fam
    this.ctx.markDirty(); this.ctx.sync()
    this.render()
    void this.ctx.engine.preview(this.ch.id, 60 + (this.octave - 4) * 12, 8, 0.9)
  }

  /* ---------------- oscillateurs ---------------- */

  private waveRow(cur: Wave, set: (w: Wave) => void): HTMLElement {
    const row = h('div', { class: 'syn-waves' })
    for (const w of WAVES) {
      const b = h('button', {
        class: `syn-wave${w === cur ? ' on' : ''}`, title: WAVE_LABEL[w],
        onclick: () => { set(w); this.render() },
      }, icon(WAVE_ICON[w], 16))
      row.appendChild(b)
    }
    return row
  }

  private K(label: string, min: number, max: number, get: () => number, set: (v: number) => void,
            def: number, curve = 1, fmt?: (v: number) => string, size = 40, color = '#ffbe4d') {
    return knob({
      min, max, value: get(), def, label, size, curve, color, format: fmt,
      onInput: (v) => { set(v); this.touched() },
    })
  }

  private oscSec(tag: 'A' | 'B', o: OscParams): HTMLElement {
    const int = (v: number) => String(Math.round(v))
    return h('div', { class: 'syn-sec', style: { flex: '1 1 320px' } },
      h('h4', {}, `Oscillateur ${tag}`, h('span', { class: 'sub' }, WAVE_LABEL[o.wave])),
      h('div', { class: 'syn-body' },
        h('div', { class: 'syn-col' },
          this.waveRow(o.wave, (w) => { o.wave = w; this.touched() }),
          o.wave === 'pulse'
            ? this.K('LARGEUR', 0.05, 0.95, () => o.pw, (v) => { o.pw = v }, 0.5, 1, (v) => `${Math.round(v * 100)}%`, 34)
            : null,
        ),
        this.K('OCTAVE', -3, 3, () => o.oct, (v) => { o.oct = Math.round(v) }, 0, 1, int, 36),
        this.K('DEMI-TON', -12, 12, () => o.semi, (v) => { o.semi = Math.round(v) }, 0, 1, int, 36),
        this.K('FIN', -50, 50, () => o.fine, (v) => { o.fine = v }, 0, 1, (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}c`, 36),
        this.K('NIVEAU', 0, 1, () => o.level, (v) => { o.level = v }, 1, 1, (v) => `${Math.round(v * 100)}`, 36),
        this.K('UNISSON', 1, 7, () => o.unison, (v) => { o.unison = Math.round(v) }, 1, 1, int, 36),
        this.K('DESACCORD', 0, 60, () => o.detune, (v) => { o.detune = v }, 12, 1, (v) => `${v.toFixed(0)}c`, 36),
        this.K('LARGEUR ST', 0, 1, () => o.spread, (v) => { o.spread = v }, 0.5, 1, (v) => `${Math.round(v * 100)}%`, 36),
      ))
  }

  private mixSec(): HTMLElement {
    const p = this.p()
    return h('div', { class: 'syn-sec', style: { flex: '1 1 300px' } },
      h('h4', {}, 'Melange & sources'),
      h('div', { class: 'syn-body' },
        this.K('A ↔ B', 0, 1, () => p.mix, (v) => { p.mix = v }, 0.35, 1,
          (v) => (v < 0.02 ? 'A' : v > 0.98 ? 'B' : `${Math.round((1 - v) * 100)}/${Math.round(v * 100)}`), 46, '#5fe6ff'),
        h('div', { class: 'syn-col' },
          h('span', { class: 'knob-label' }, 'SOUS-OCTAVE'),
          h('select', { class: 'syn-pick', onchange: (e: Event) => { p.sub.wave = (e.target as HTMLSelectElement).value as 'sine'; this.touched() } },
            ...(['sine', 'triangle', 'square'] as const).map((w) =>
              h('option', { value: w, selected: p.sub.wave === w }, WAVE_LABEL[w as Wave]))),
          h('select', { class: 'syn-pick', onchange: (e: Event) => { p.sub.oct = Number((e.target as HTMLSelectElement).value); this.touched() } },
            ...[-2, -1, 0].map((o) => h('option', { value: String(o), selected: p.sub.oct === o }, `${o} oct`))),
        ),
        this.K('SUB', 0, 1, () => p.sub.level, (v) => { p.sub.level = v }, 0.25, 1, (v) => `${Math.round(v * 100)}`, 38),
        this.K('BRUIT', 0, 1, () => p.noise, (v) => { p.noise = v }, 0, 1, (v) => `${Math.round(v * 100)}`, 38),
        this.K('ANNEAU', 0, 1, () => p.ring, (v) => { p.ring = v }, 0, 1, (v) => `${Math.round(v * 100)}`, 38, '#ff7ad9'),
      ))
  }

  /* ---------------- filtre ---------------- */

  private filterSec(): HTMLElement {
    const f = this.p().filter
    this.curveCv = h('canvas', { class: 'syn-curve', width: '260', height: '86' }) as HTMLCanvasElement
    this.curveCv.style.width = '130px'; this.curveCv.style.height = '43px'
    return h('div', { class: 'syn-sec', style: { flex: '1 1 340px' } },
      h('h4', {}, 'Filtre', h('span', { class: 'sub' }, FILTER_LABEL[f.kind])),
      h('div', { class: 'syn-body' },
        h('div', { class: 'syn-col' },
          h('select', {
            class: 'syn-pick',
            onchange: (e: Event) => { f.kind = (e.target as HTMLSelectElement).value as FilterKind; this.ctx.markDirty(); this.ctx.sync(); this.render() },
          }, ...(Object.keys(FILTER_LABEL) as FilterKind[]).map((k) =>
            h('option', { value: k, selected: f.kind === k }, FILTER_LABEL[k]))),
          this.curveCv,
        ),
        this.K('FREQUENCE', 20, 18000, () => f.cutoff, (v) => { f.cutoff = v }, 2600, 2.8,
          (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v.toFixed(0)}`), 46, '#5fe6ff'),
        this.K('RESONANCE', 0, 26, () => f.reso, (v) => { f.reso = v }, 4, 1, (v) => v.toFixed(1), 42),
        this.K('ENVELOPPE', 0, 1, () => f.env, (v) => { f.env = v }, 0.5, 1, (v) => `${Math.round(v * 100)}%`, 42),
        this.K('SUIVI CLAVIER', 0, 1, () => f.key, (v) => { f.key = v }, 0.35, 1, (v) => `${Math.round(v * 100)}%`, 38),
        this.K('SATURATION', 0, 1, () => f.drive, (v) => { f.drive = v }, 0.1, 1, (v) => `${Math.round(v * 100)}%`, 38),
      ))
  }

  /* ---------------- enveloppes ---------------- */

  private envSec(title: string, e: Env, color: string): HTMLElement {
    const cv = h('canvas', { class: 'syn-curve', width: '280', height: '96' }) as HTMLCanvasElement
    cv.style.width = '140px'; cv.style.height = '48px'
    if (title === 'AMPLITUDE') this.ampCv = cv; else this.filtCv = cv
    const t = (v: number) => (v >= 1 ? `${v.toFixed(2)}s` : `${(v * 1000).toFixed(0)}ms`)
    return h('div', { class: 'syn-sec', style: { flex: '1 1 300px' } },
      h('h4', {}, `Enveloppe ${title}`),
      h('div', { class: 'syn-body' },
        cv,
        this.K('ATTAQUE', 0, 3, () => e.a, (v) => { e.a = v }, 0.006, 2.6, t, 38, color),
        this.K('DECLIN', 0.004, 3, () => e.d, (v) => { e.d = v }, 0.3, 2.4, t, 38, color),
        this.K('MAINTIEN', 0, 1, () => e.s, (v) => { e.s = v }, 0.6, 1, (v) => `${Math.round(v * 100)}%`, 38, color),
        this.K('RELACHE', 0.008, 4, () => e.r, (v) => { e.r = v }, 0.26, 2.4, t, 38, color),
      ))
  }

  /* ---------------- LFO ---------------- */

  private lfoSec(n: 1 | 2, l: Lfo): HTMLElement {
    const shapes: LfoShape[] = ['sine', 'tri', 'saw', 'square', 'sh']
    const rate = l.sync
      ? this.K('DIVISION', 0, LFO_DIV_LABELS.length - 1, () => l.div, (v) => { l.div = Math.round(v) }, 4, 1,
          (v) => LFO_DIV_LABELS[clamp(Math.round(v), 0, LFO_DIV_LABELS.length - 1)], 40, '#a98bff')
      : this.K('VITESSE', 0.02, 24, () => l.rate, (v) => { l.rate = v }, 5, 2.2, (v) => `${v.toFixed(2)}Hz`, 40, '#a98bff')

    return h('div', { class: 'syn-sec', style: { flex: '1 1 320px' } },
      h('h4', {}, `LFO ${n}`, h('span', { class: 'sub' }, LFO_LABEL[l.shape])),
      h('div', { class: 'syn-body' },
        h('div', { class: 'syn-col' },
          h('div', { class: 'syn-waves' }, ...shapes.map((sh) => h('button', {
            class: `syn-wave${l.shape === sh ? ' on' : ''}`, title: LFO_LABEL[sh],
            onclick: () => { l.shape = sh; this.ctx.markDirty(); this.ctx.sync(); this.render() },
          }, icon(LFO_ICON[sh], 16)))),
          h('button', {
            class: `syn-toggle${l.sync ? ' on' : ''}`,
            onclick: () => { l.sync = !l.sync; this.ctx.markDirty(); this.ctx.sync(); this.render() },
          }, l.sync ? 'AU TEMPO' : 'LIBRE'),
        ),
        rate,
        this.K('MONTEE', 0, 4, () => l.fade, (v) => { l.fade = v }, 0, 2.2, (v) => `${v.toFixed(2)}s`, 36, '#a98bff'),
        this.K('→ HAUTEUR', -1200, 1200, () => l.toPitch, (v) => { l.toPitch = v }, 0, 1, (v) => `${v.toFixed(0)}c`, 36),
        this.K('→ FILTRE', -1, 1, () => l.toCut, (v) => { l.toCut = v }, 0, 1, (v) => `${Math.round(v * 100)}%`, 36),
        this.K('→ VOLUME', 0, 1, () => l.toAmp, (v) => { l.toAmp = v }, 0, 1, (v) => `${Math.round(v * 100)}%`, 36),
        this.K('→ STEREO', 0, 1, () => l.toPan, (v) => { l.toPan = v }, 0, 1, (v) => `${Math.round(v * 100)}%`, 36),
      ))
  }

  /* ---------------- voix et effets ---------------- */

  private voiceSec(): HTMLElement {
    const p = this.p()
    return h('div', { class: 'syn-sec', style: { flex: '1 1 280px' } },
      h('h4', {}, 'Voix'),
      h('div', { class: 'syn-body' },
        h('button', {
          class: `syn-toggle${p.mono ? ' on' : ''}`,
          onclick: () => { p.mono = !p.mono; this.ctx.markDirty(); this.render() },
        }, p.mono ? 'MONOPHONIQUE' : 'POLYPHONIQUE'),
        this.K('GLISSANDO', 0, 1, () => p.glide, (v) => { p.glide = v }, 0, 2.4, (v) => `${(v * 1000).toFixed(0)}ms`, 38),
        this.K('VEL → VOLUME', 0, 1, () => p.velAmp, (v) => { p.velAmp = v }, 0.6, 1, (v) => `${Math.round(v * 100)}%`, 38),
        this.K('VEL → FILTRE', 0, 1, () => p.velCut, (v) => { p.velCut = v }, 0.3, 1, (v) => `${Math.round(v * 100)}%`, 38),
        this.K('VOLUME', 0, 1.5, () => p.gain, (v) => { p.gain = v }, 0.8, 1, (v) => `${Math.round(v * 100)}`, 42),
      ))
  }

  private fxSec(): HTMLElement {
    const f = this.p().fx
    return h('div', { class: 'syn-sec', style: { flex: '1 1 360px' } },
      h('h4', {}, 'Effets integres', h('span', { class: 'sub' }, 'inclus dans le preset')),
      h('div', { class: 'syn-body' },
        this.K('SATURATION', 0, 1, () => f.drive, (v) => { f.drive = v }, 0, 1, (v) => `${Math.round(v * 100)}%`, 38),
        this.K('CHORUS', 0, 1, () => f.chorus, (v) => { f.chorus = v }, 0, 1, (v) => `${Math.round(v * 100)}%`, 38),
        this.K('ECHO', 0, 1, () => f.delay, (v) => { f.delay = v }, 0, 1, (v) => `${Math.round(v * 100)}%`, 38, '#5fe6ff'),
        this.K('DIVISION', 0, DLY_DIV_LABELS.length - 1, () => f.delayDiv, (v) => { f.delayDiv = Math.round(v) }, 3, 1,
          (v) => DLY_DIV_LABELS[clamp(Math.round(v), 0, DLY_DIV_LABELS.length - 1)], 36, '#5fe6ff'),
        this.K('REINJECTION', 0, 0.9, () => f.delayFb, (v) => { f.delayFb = v }, 0.35, 1, (v) => `${Math.round(v * 100)}%`, 36, '#5fe6ff'),
        this.K('REVERBE', 0, 1, () => f.reverb, (v) => { f.reverb = v }, 0, 1, (v) => `${Math.round(v * 100)}%`, 38, '#a98bff'),
        this.K('TAILLE', 0.3, 6, () => f.size, (v) => { f.size = v }, 2, 1.6, (v) => `${v.toFixed(1)}s`, 36, '#a98bff'),
      ))
  }

  /* ---------------- courbes ---------------- */

  private paintCurves() {
    if (this.ampCv) this.drawEnv(this.ampCv, this.p().ampEnv, '#ffbe4d')
    if (this.filtCv) this.drawEnv(this.filtCv, this.p().filtEnv, '#5fe6ff')
    if (this.curveCv) this.drawFilter(this.curveCv)
  }

  private drawEnv(cv: HTMLCanvasElement, e: Env, color: string) {
    const g = cv.getContext('2d')
    if (!g) return
    const W = cv.width, H = cv.height, pad = 6
    g.clearRect(0, 0, W, H)
    g.fillStyle = '#14181f'; g.fillRect(0, 0, W, H)
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo((W / 4) * i, 0); g.lineTo((W / 4) * i, H); g.stroke() }

    // repartition proportionnelle des phases, avec un maintien fixe
    const total = e.a + e.d + 0.35 + e.r
    const w = W - pad * 2
    const xa = pad + (e.a / total) * w
    const xd = xa + (e.d / total) * w
    const xs = xd + (0.35 / total) * w
    const xr = xs + (e.r / total) * w
    const y0 = H - pad, y1 = pad
    const ys = y0 - (y0 - y1) * clamp(e.s, 0, 1)

    g.beginPath()
    g.moveTo(pad, y0); g.lineTo(xa, y1)
    g.quadraticCurveTo(xa + (xd - xa) * 0.35, ys + (y1 - ys) * 0.35, xd, ys)
    g.lineTo(xs, ys)
    g.quadraticCurveTo(xs + (xr - xs) * 0.35, y0 + (ys - y0) * 0.2, xr, y0)
    g.strokeStyle = color; g.lineWidth = 2.2; g.lineJoin = 'round'; g.stroke()
    g.lineTo(pad, y0); g.closePath()
    g.fillStyle = color.replace(')', ',.16)').replace('#', 'rgba(').length > 0 ? hexA(color, 0.16) : color
    g.fill()

    g.fillStyle = 'rgba(255,255,255,.55)'
    for (const x of [xa, xd, xs]) { g.beginPath(); g.arc(x, x === xa ? y1 : ys, 2.4, 0, Math.PI * 2); g.fill() }
  }

  private drawFilter(cv: HTMLCanvasElement) {
    const g = cv.getContext('2d')
    if (!g) return
    const f = this.p().filter
    const W = cv.width, H = cv.height
    g.clearRect(0, 0, W, H)
    g.fillStyle = '#14181f'; g.fillRect(0, 0, W, H)
    g.strokeStyle = 'rgba(255,255,255,.07)'
    for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo((W / 5) * i, 0); g.lineTo((W / 5) * i, H); g.stroke() }
    if (f.kind === 'off') {
      g.strokeStyle = '#5fe6ff'; g.lineWidth = 2
      g.beginPath(); g.moveTo(0, H * 0.3); g.lineTo(W, H * 0.3); g.stroke()
      return
    }
    // reponse approchee, tracee en echelle logarithmique
    const fc = clamp(f.cutoff, 20, 19000)
    const q = clamp(f.reso, 0.5, 26)
    const slope = f.kind === 'lp24' ? 2 : 1
    g.beginPath()
    for (let x = 0; x <= W; x++) {
      const freq = 20 * Math.pow(950, x / W)
      const r = freq / fc
      let mag: number
      if (f.kind === 'hp12') mag = Math.pow(r, 2) / Math.sqrt(Math.pow(1 - r * r, 2) + Math.pow(r / q, 2))
      else if (f.kind === 'bp') mag = (r / q) / Math.sqrt(Math.pow(1 - r * r, 2) + Math.pow(r / q, 2))
      else if (f.kind === 'notch') mag = Math.abs(1 - r * r) / Math.sqrt(Math.pow(1 - r * r, 2) + Math.pow(r / q, 2))
      else mag = Math.pow(1 / Math.sqrt(Math.pow(1 - r * r, 2) + Math.pow(r / q, 2)), slope)
      const db = 20 * Math.log10(Math.max(1e-4, mag))
      const y = H * 0.62 - (db / 34) * H * 0.6
      if (x === 0) g.moveTo(x, clamp(y, -20, H + 20)); else g.lineTo(x, clamp(y, -20, H + 20))
    }
    g.strokeStyle = '#5fe6ff'; g.lineWidth = 2; g.stroke()
    const cx = (Math.log(fc / 20) / Math.log(950)) * W
    g.strokeStyle = 'rgba(255,190,77,.55)'; g.lineWidth = 1
    g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, H); g.stroke()
  }

  /* ---------------- clavier ---------------- */

  private keyboard(): HTMLElement {
    const wrap = h('div', { class: 'syn-keys' })
    this.keyEls.clear()
    const lo = 12 * this.octave, span = 24            // deux octaves
    const whites: number[] = []
    for (let k = lo; k < lo + span; k++) if (!isBlack(k)) whites.push(k)
    const wW = 100 / whites.length

    whites.forEach((k, i) => {
      const el = h('div', {
        class: 'syn-key', style: { left: `${i * wW}%`, width: `${wW}%` },
        dataset: { k: String(k) },
      }, k % 12 === 0 ? h('span', { class: 'lbl' }, keyName(k)) : null)
      wrap.appendChild(el)
      this.keyEls.set(k, el)
    })
    for (let k = lo; k < lo + span; k++) {
      if (!isBlack(k)) continue
      const leftWhite = whites.filter((w) => w < k).length
      const el = h('div', {
        class: 'syn-key black',
        style: { left: `calc(${leftWhite * wW}% - ${wW * 0.29}%)`, width: `${wW * 0.58}%` },
        dataset: { k: String(k) },
      })
      wrap.appendChild(el)
      this.keyEls.set(k, el)
    }

    let down = false
    const noteAt = (t: EventTarget | null) => {
      const el = (t as HTMLElement)?.closest?.('.syn-key') as HTMLElement | null
      return el ? Number(el.dataset.k) : null
    }
    wrap.addEventListener('pointerdown', (e) => {
      down = true; wrap.setPointerCapture(e.pointerId)
      const k = noteAt(e.target); if (k !== null) this.strike(k)
    })
    wrap.addEventListener('pointermove', (e) => {
      if (!down) return
      const k = noteAt(document.elementFromPoint(e.clientX, e.clientY))
      if (k !== null && !this.held.has(k)) this.strike(k)
    })
    const up = () => { down = false }
    wrap.addEventListener('pointerup', up)
    wrap.addEventListener('pointercancel', up)

    const bar = h('div', { class: 'syn-kbbar' },
      h('button', { class: 'syn-pick', onclick: () => { this.octave = clamp(this.octave - 1, 0, 7); this.rebuildKeys() } }, '− OCT'),
      h('span', { class: 'pill' }, `C${this.octave}`),
      h('button', { class: 'syn-pick', onclick: () => { this.octave = clamp(this.octave + 1, 0, 7); this.rebuildKeys() } }, '+ OCT'),
      h('button', {
        class: `syn-toggle${this.kbOn ? ' on' : ''}`,
        onclick: (e: Event) => {
          this.kbOn = !this.kbOn
          ;(e.currentTarget as HTMLElement).classList.toggle('on', this.kbOn)
        },
      }, 'CLAVIER PC'),
      h('span', {}, 'joue avec les touches A/Q S D F G H J K et Z/W E T Y U · flèches ↑↓ pour l\'octave'),
    )
    return h('div', {}, bar, wrap)
  }

  private rebuildKeys() {
    clear(this.kbHost)
    this.kbHost.appendChild(this.keyboard())
  }

  private strike(key: number, vel = 0.9) {
    if (this.held.has(key)) return
    this.held.set(key, performance.now())
    this.keyEls.get(key)?.classList.add('on')
    void this.ctx.engine.preview(this.ch.id, key, 6, vel)
    // la voix s'eteint d'elle-meme : on ne garde le repere visuel qu'un instant
    window.setTimeout(() => {
      this.held.delete(key)
      this.keyEls.get(key)?.classList.remove('on')
    }, 420)
  }

  private upKey = () => { /* les voix sont declenchees a duree fixe */ }

  private bindKeyboard() {
    this.onKey = (e: KeyboardEvent) => {
      if (!this.kbOn || !this.el.isConnected || !this.el.offsetParent) return
      const t = e.target as HTMLElement
      if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'ArrowUp') { this.octave = clamp(this.octave + 1, 0, 7); this.rebuildKeys(); e.preventDefault(); return }
      if (e.key === 'ArrowDown') { this.octave = clamp(this.octave - 1, 0, 7); this.rebuildKeys(); e.preventDefault(); return }
      const off = KEYMAP[e.key.toLowerCase()]
      if (off === undefined || e.repeat) return
      e.preventDefault()
      this.strike(12 * this.octave + off)
    }
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.upKey)
  }
}

function hexA(hex: string, a: number): string {
  const m = hex.replace('#', '')
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
