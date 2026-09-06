/* ============================================================
   DJ ViDAW — FACE AVANT DU SYNTHETISEUR
   Disposition en flux de signal : les oscillateurs a gauche, le
   filtre au centre, l'afficheur a droite ; en dessous les deux
   enveloppes qu'on attrape par leurs points, puis les modulations.
   La taille d'une commande dit son importance — une grille de
   potards identiques ne dit rien.
   ============================================================ */

import { h, clear } from './dom'
import { icon } from './icons'
import { knob } from './knob'
import { envEditor, scopeDisplay, waveThumb, lfoDisplay, type EnvEditor, type LfoView } from './widgets'
import type { Ctx } from './ctx'
import type { Channel } from '../core/state'
import { clamp, keyName, isBlack } from '../core/state'
import {
  WAVES, WAVE_LABEL, FILTER_LABEL, LFO_LABEL, LFO_DIV_LABELS, DLY_DIV_LABELS,
  type SynthParams, type OscParams, type Lfo, type Wave, type FilterKind, type LfoShape,
} from '../audio/synth'
import { PRESETS, FAMILIES, loadPreset, type Family } from '../audio/presets'

const WAVE_ICON: Record<Wave, string> = {
  saw: 'wsaw', square: 'wsquare', pulse: 'wpulse', triangle: 'wtri', sine: 'wsine', noise: 'wnoise',
}
const LFO_ICON: Record<LfoShape, string> = {
  sine: 'wsine', tri: 'wtri', saw: 'wramp', square: 'wsquare', sh: 'wsh',
}

/* Clavier d'ordinateur, par caractere produit : couvre AZERTY et QWERTY. */
const KEYMAP: Record<string, number> = {
  q: 0, a: 0, z: 1, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7,
  y: 8, h: 9, u: 10, j: 11, k: 12, l: 14, m: 16,
}

const AMBER = '#ef9c39'
const CYAN = '#4ea3e8'
const VIOLET = '#9b8ae0'

export class SynthPanel {
  el: HTMLElement
  private scroll: HTMLElement
  private ch: Channel
  private preset = -1
  private fam: Family = 'BASSES'
  private octave = 4
  private held = new Set<number>()
  private keyEls = new Map<number, HTMLElement>()
  private kbOn = true
  private kbHost!: HTMLElement
  private onKey: ((e: KeyboardEvent) => void) | null = null

  private scope = scopeDisplay()
  private ampEnv: EnvEditor | null = null
  private filtEnv: EnvEditor | null = null
  private filtCurve: HTMLCanvasElement | null = null
  private thumbs: { view: ReturnType<typeof waveThumb>; osc: () => OscParams }[] = []
  private lfoViews: LfoView[] = []
  private lcdName!: HTMLElement
  private lcdNote!: HTMLElement
  private lcdFam!: HTMLElement
  private listEl!: HTMLElement
  private meta!: HTMLElement
  private raf = 0

  constructor(private ctx: Ctx, ch: Channel) {
    this.ch = ch
    this.scroll = h('div', { class: 'syn-scroll' })
    this.kbHost = h('div', { class: 'syn-kbhost' })
    this.el = h('div', { class: 'syn' }, this.scroll, this.kbHost)
    this.render()
    this.bindKeyboard()
    this.tick()
  }

  /** Appelee quand la fenetre change de taille : les canevas fluides
      doivent se remesurer. */
  resize() {
    this.ampEnv?.draw()
    this.filtEnv?.draw()
    this.paintFilter()
  }

  setChannel(ch: Channel) {
    this.ch = ch
    this.preset = -1
    this.render()
    this.attachProbe()
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    if (this.onKey) window.removeEventListener('keydown', this.onKey)
  }

  private p(): SynthParams { return this.ch.synth! }

  private attachProbe() {
    this.scope.setAnalyser(this.ctx.engine.probe(this.ch.id))
  }

  private touched() {
    this.ctx.markDirty()
    this.ctx.sync()
    this.ampEnv?.draw()
    this.filtEnv?.draw()
    this.paintFilter()
    this.paintThumbs()
  }

  /* ================= boucle d'affichage ================= */

  private tick = () => {
    this.raf = requestAnimationFrame(this.tick)
    if (!this.el.isConnected || !this.el.offsetParent) return
    this.scope.tick()
    this.paintFilter()
    const bpm = this.ctx.project.bpm
    for (const v of this.lfoViews) v.tick(bpm)
  }

  /* ================= rendu ================= */

  render() {
    clear(this.scroll)
    this.thumbs = []
    this.lfoViews = []
    const p = this.p()

    this.scroll.append(
      this.rail(),
      h('div', { class: 'syn-grid' }, this.oscPlate(), this.filterPlate(), this.scopePlate()),
      h('div', { class: 'syn-pair' },
        this.envPlate('Enveloppe amplitude', 'ce que devient le volume dans le temps', () => this.p().ampEnv, AMBER),
        this.envPlate('Enveloppe filtre', 'la meme chose, appliquee au timbre', () => this.p().filtEnv, CYAN)),
      h('div', { class: 'syn-pair' }, this.lfoPlate(1, p.lfo1), this.lfoPlate(2, p.lfo2)),
      h('div', { class: 'syn-pair' }, this.voicePlate(), this.fxPlate()),
    )
    this.rebuildKeys()
    requestAnimationFrame(() => { this.paintFilter(); this.paintThumbs(); this.attachProbe() })
  }

  /* ---------------- rail des presets ---------------- */

  private rail(): HTMLElement {
    const cur = this.preset >= 0 ? PRESETS[this.preset] : null
    this.lcdName = h('b', {}, cur ? cur.name : 'REGLAGE LIBRE')
    this.lcdNote = h('i', {}, cur ? cur.note : 'aucun preset charge')
    this.lcdFam = h('span', { class: 'fam' }, cur ? cur.fam : '—')
    this.listEl = h('div', { class: 'syn-list' })

    const step = (d: number) => this.apply(clamp((this.preset < 0 ? -1 : this.preset) + d, 0, PRESETS.length - 1))

    const plate = h('div', { class: 'plate' },
      h('h4', {}, 'Presets', h('span', { class: 'sub' }, `${PRESETS.length} sons en ${FAMILIES.length} familles`)),
      h('div', { class: 'syn-rail' },
        h('div', { class: 'patch-lcd' }, this.lcdFam, this.lcdName, this.lcdNote),
        h('div', { class: 'syn-nav' },
          h('div', { class: 'row' },
            h('button', { class: 'syn-pick', title: 'Preset precedent', dataset: { tip: 'Preset precedent' }, onclick: () => step(-1) }, '◀'),
            h('button', { class: 'syn-pick', title: 'Preset suivant', dataset: { tip: 'Preset suivant' }, onclick: () => step(1) }, '▶'),
            h('button', {
              class: 'syn-pick', title: 'Au hasard', dataset: { tip: 'Charge un preset au hasard' },
              onclick: () => this.apply(Math.floor(Math.random() * PRESETS.length)),
            }, icon('dice', 12))),
          h('button', {
            class: 'syn-pick', dataset: { tip: 'Joue une note pour entendre le reglage' },
            onclick: () => this.preview(60 + (this.octave - 4) * 12),
          }, icon('play', 12), ' TESTER'),
        ),
        h('div', { class: 'syn-fams' }, ...FAMILIES.map((f) => h('button', {
          class: `syn-fam${f === this.fam ? ' on' : ''}`,
          onclick: () => { this.fam = f; this.render() },
        }, f))),
        this.listEl,
      ))
    this.fillList()
    return plate
  }

  private fillList() {
    clear(this.listEl)
    PRESETS.forEach((pr, i) => {
      if (pr.fam !== this.fam) return
      this.listEl.appendChild(h('div', {
        class: `syn-item${i === this.preset ? ' on' : ''}`,
        dataset: { tip: pr.note },
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
    this.preview(60 + (this.octave - 4) * 12)
  }

  private preview(key: number, vel = 0.9) {
    void this.ctx.engine.preview(this.ch.id, key, 8, vel).then(() => this.attachProbe())
  }

  /* ---------------- outils communs ---------------- */

  private K(o: {
    label: string; min: number; max: number; get: () => number; set: (v: number) => void
    def: number; curve?: number; fmt?: (v: number) => string; size?: number; color?: string
    ticks?: number; tip?: string
  }) {
    const k = knob({
      min: o.min, max: o.max, value: o.get(), def: o.def, label: o.label,
      size: o.size ?? 38, curve: o.curve ?? 1, color: o.color ?? AMBER,
      format: o.fmt, ticks: o.ticks,
      onInput: (v) => { o.set(v); this.touched() },
    })
    if (o.tip) k.dataset.tip = o.tip
    return k
  }

  private waveRow(cur: Wave, set: (w: Wave) => void): HTMLElement {
    return h('div', { class: 'syn-waves' }, ...WAVES.map((w) => h('button', {
      class: `syn-wave${w === cur ? ' on' : ''}`, title: WAVE_LABEL[w],
      dataset: { tip: `Forme d'onde : ${WAVE_LABEL[w].toLowerCase()}` },
      onclick: () => { set(w); this.render() },
    }, icon(WAVE_ICON[w], 15))))
  }

  /* ---------------- oscillateurs ---------------- */

  private oscModule(tag: 'A' | 'B', o: OscParams): HTMLElement {
    const thumb = waveThumb(52, 28)
    this.thumbs.push({ view: thumb, osc: () => o })
    const int = (v: number) => String(Math.round(v))

    return h('div', { class: 'osc-mod' },
      h('div', { class: 'osc-head' },
        h('span', { class: 'osc-tag' }, tag),
        thumb.el,
        this.waveRow(o.wave, (w) => { o.wave = w; this.touched() }),
        o.wave === 'pulse'
          ? this.K({ label: 'CYCLE', min: .05, max: .95, get: () => o.pw, set: (v) => { o.pw = v }, def: .5, size: 32,
                     fmt: (v) => `${Math.round(v * 100)}%`, tip: 'Largeur de l\'impulsion' })
          : null,
      ),
      h('div', { class: 'osc-knobs' },
        this.K({ label: 'OCTAVE', min: -3, max: 3, get: () => o.oct, set: (v) => { o.oct = Math.round(v) }, def: 0, fmt: int, size: 32 }),
        this.K({ label: 'DEMI-TON', min: -12, max: 12, get: () => o.semi, set: (v) => { o.semi = Math.round(v) }, def: 0, fmt: int, size: 32 }),
        this.K({ label: 'FIN', min: -50, max: 50, get: () => o.fine, set: (v) => { o.fine = v }, def: 0, size: 32,
                 fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}c`, tip: 'Desaccord fin, en centiemes de demi-ton' }),
        this.K({ label: 'NIVEAU', min: 0, max: 1, get: () => o.level, set: (v) => { o.level = v }, def: 1, size: 32,
                 fmt: (v) => `${Math.round(v * 100)}` }),
        this.K({ label: 'UNISSON', min: 1, max: 7, get: () => o.unison, set: (v) => { o.unison = Math.round(v) }, def: 1,
                 fmt: int, size: 34, color: CYAN, tip: 'Nombre de voix empilees et desaccordees' }),
        this.K({ label: 'DESACCORD', min: 0, max: 60, get: () => o.detune, set: (v) => { o.detune = v }, def: 12, size: 32,
                 color: CYAN, fmt: (v) => `${v.toFixed(0)}c` }),
        this.K({ label: 'LARGEUR', min: 0, max: 1, get: () => o.spread, set: (v) => { o.spread = v }, def: .5, size: 32,
                 color: CYAN, fmt: (v) => `${Math.round(v * 100)}%`, tip: 'Etalement des voix d\'unisson dans le stereo' }),
      ))
  }

  private oscPlate(): HTMLElement {
    const p = this.p()
    return h('div', { class: 'plate' },
      h('h4', {}, 'Oscillateurs',
        h('span', { class: 'spacer' }),
        h('span', { class: 'sub' }, 'la matiere premiere')),
      h('div', { class: 'plate-body', style: { flexDirection: 'column', gap: '8px' } },
        this.oscModule('A', p.oscA),
        this.oscModule('B', p.oscB),
        h('div', { class: 'osc-mod' },
          h('div', { class: 'osc-knobs' },
            this.K({ label: 'A ↔ B', min: 0, max: 1, get: () => p.mix, set: (v) => { p.mix = v }, def: .35, size: 46,
                     color: CYAN, ticks: 9,
                     fmt: (v) => (v < .02 ? 'A' : v > .98 ? 'B' : `${Math.round((1 - v) * 100)}/${Math.round(v * 100)}`),
                     tip: 'Dosage entre les deux oscillateurs' }),
            h('div', { class: 'syn-col', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              h('span', { class: 'knob-label' }, 'SOUS-OCTAVE'),
              h('select', {
                class: 'syn-pick',
                onchange: (e: Event) => { p.sub.wave = (e.target as HTMLSelectElement).value as 'sine'; this.touched() },
              }, ...(['sine', 'triangle', 'square'] as const).map((w) =>
                h('option', { value: w, selected: p.sub.wave === w }, WAVE_LABEL[w as Wave]))),
              h('select', {
                class: 'syn-pick',
                onchange: (e: Event) => { p.sub.oct = Number((e.target as HTMLSelectElement).value); this.touched() },
              }, ...[-2, -1, 0].map((o) => h('option', { value: String(o), selected: p.sub.oct === o }, `${o} oct`)))),
            this.K({ label: 'SUB', min: 0, max: 1, get: () => p.sub.level, set: (v) => { p.sub.level = v }, def: .25, size: 36,
                     fmt: (v) => `${Math.round(v * 100)}`, tip: 'Une octave en dessous, pour asseoir le son' }),
            this.K({ label: 'BRUIT', min: 0, max: 1, get: () => p.noise, set: (v) => { p.noise = v }, def: 0, size: 36,
                     fmt: (v) => `${Math.round(v * 100)}` }),
            this.K({ label: 'ANNEAU', min: 0, max: 1, get: () => p.ring, set: (v) => { p.ring = v }, def: 0, size: 36,
                     color: '#c26d92', fmt: (v) => `${Math.round(v * 100)}`,
                     tip: 'Modulation en anneau : A multiplie par B, pour des timbres metalliques' }),
          )),
      ))
  }

  /* ---------------- filtre ---------------- */

  private filterPlate(): HTMLElement {
    const f = this.p().filter
    this.filtCurve = h('canvas', { class: 'filter-cv', width: '400', height: '140' }) as HTMLCanvasElement


    return h('div', { class: 'plate filter-plate' },
      h('h4', {}, 'Filtre',
        h('span', { class: 'spacer' }),
        h('span', { class: 'sub' }, FILTER_LABEL[f.kind])),
      h('div', { class: 'plate-body' },
        h('div', { class: 'well filter-well' }, this.filtCurve),
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'flex-start', flexWrap: 'wrap' } },
          this.K({ label: 'FREQUENCE', min: 20, max: 18000, get: () => f.cutoff, set: (v) => { f.cutoff = v },
                   def: 2600, curve: 2.8, size: 68, ticks: 13, color: CYAN,
                   fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v.toFixed(0)}`),
                   tip: 'Frequence de coupure — la commande la plus expressive du synthetiseur' }),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', flex: '1 1 auto' } },
            this.K({ label: 'RESONANCE', min: 0, max: 26, get: () => f.reso, set: (v) => { f.reso = v }, def: 4, size: 42,
                     fmt: (v) => v.toFixed(1), tip: 'Bosse a la coupure. Au-dela de 20, ca siffle.' }),
            this.K({ label: 'ENVELOPPE', min: 0, max: 1, get: () => f.env, set: (v) => { f.env = v }, def: .5, size: 42,
                     fmt: (v) => `${Math.round(v * 100)}%`, tip: 'De combien l\'enveloppe filtre ouvre la coupure' }),
            this.K({ label: 'SUIVI', min: 0, max: 1, get: () => f.key, set: (v) => { f.key = v }, def: .35, size: 36,
                     fmt: (v) => `${Math.round(v * 100)}%`, tip: 'La coupure suit la note jouee' }),
            this.K({ label: 'SATURATION', min: 0, max: 1, get: () => f.drive, set: (v) => { f.drive = v }, def: .1, size: 36,
                     fmt: (v) => `${Math.round(v * 100)}%` }),
          )),
        h('select', {
          class: 'syn-pick', style: { width: '100%' },
          onchange: (e: Event) => {
            f.kind = (e.target as HTMLSelectElement).value as FilterKind
            this.ctx.markDirty(); this.ctx.sync(); this.render()
          },
        }, ...(Object.keys(FILTER_LABEL) as FilterKind[]).map((k) =>
          h('option', { value: k, selected: f.kind === k }, FILTER_LABEL[k]))),
      ))
  }

  private paintFilter() {
    const cv = this.filtCurve
    if (!cv) return
    const k = Math.min(2, window.devicePixelRatio || 1)
    const cw = Math.max(120, cv.clientWidth), chh = Math.max(50, cv.clientHeight)
    if (cv.width !== Math.round(cw * k)) { cv.width = Math.round(cw * k); cv.height = Math.round(chh * k) }
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(1, 0, 0, 1, 0, 0)
    const f = this.p().filter
    const W = cv.width, H = cv.height
    g.clearRect(0, 0, W, H)
    g.fillStyle = '#0d1017'; g.fillRect(0, 0, W, H)

    // reperes de frequence
    g.font = '16px "Courier New", monospace'
    for (const [hz, lbl] of [[100, '100'], [1000, '1k'], [10000, '10k']] as [number, string][]) {
      const x = (Math.log(hz / 20) / Math.log(950)) * W
      g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 2
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke()
      g.fillStyle = 'rgba(150,164,186,.4)'
      g.fillText(lbl, x + 4, H - 6)
    }

    if (f.kind === 'off') {
      g.strokeStyle = CYAN; g.lineWidth = 4
      g.beginPath(); g.moveTo(0, H * 0.35); g.lineTo(W, H * 0.35); g.stroke()
      return
    }
    const fc = clamp(f.cutoff, 20, 19000)
    const q = clamp(f.reso, 0.5, 26)
    const slope = f.kind === 'lp24' ? 2 : 1
    const pts: [number, number][] = []
    for (let x = 0; x <= W; x += 2) {
      const freq = 20 * Math.pow(950, x / W)
      const r = freq / fc
      let mag: number
      if (f.kind === 'hp12') mag = (r * r) / Math.sqrt(Math.pow(1 - r * r, 2) + Math.pow(r / q, 2))
      else if (f.kind === 'bp') mag = (r / q) / Math.sqrt(Math.pow(1 - r * r, 2) + Math.pow(r / q, 2))
      else if (f.kind === 'notch') mag = Math.abs(1 - r * r) / Math.sqrt(Math.pow(1 - r * r, 2) + Math.pow(r / q, 2))
      else mag = Math.pow(1 / Math.sqrt(Math.pow(1 - r * r, 2) + Math.pow(r / q, 2)), slope)
      const db = 20 * Math.log10(Math.max(1e-4, mag))
      pts.push([x, clamp(H * 0.6 - (db / 34) * H * 0.58, -40, H + 40)])
    }
    // remplissage sous la courbe
    g.beginPath()
    g.moveTo(0, H)
    for (const [x, y] of pts) g.lineTo(x, y)
    g.lineTo(W, H); g.closePath()
    const grad = g.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, 'rgba(78,163,232,.34)')
    grad.addColorStop(1, 'rgba(78,163,232,.03)')
    g.fillStyle = grad; g.fill()

    g.beginPath()
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
    g.strokeStyle = CYAN; g.lineWidth = 4; g.lineJoin = 'round'; g.stroke()

    const cx = (Math.log(fc / 20) / Math.log(950)) * W
    g.strokeStyle = 'rgba(255,190,77,.5)'; g.lineWidth = 2
    g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, H); g.stroke()
    g.beginPath(); g.arc(cx, pts[Math.min(pts.length - 1, Math.round(cx / 2))]?.[1] ?? H / 2, 5, 0, Math.PI * 2)
    g.fillStyle = '#ffbe4d'; g.fill()
  }

  private paintThumbs() {
    for (const t of this.thumbs) {
      const o = t.osc()
      t.view.draw(o.wave, o.pw, o.level > .02 ? AMBER : 'rgba(239,156,57,.3)')
    }
  }

  /* ---------------- afficheur ---------------- */

  private scopePlate(): HTMLElement {
    this.meta = h('div', { class: 'scope-meta' })
    return h('div', { class: 'plate scope-plate' },
      h('h4', {}, 'Sortie', h('span', { class: 'spacer' }), h('span', { class: 'sub' }, 'signal reel')),
      h('div', { class: 'plate-body' },
        this.scope.el,
        this.meta,
      ))
  }

  /* ---------------- enveloppes ---------------- */

  private envPlate(title: string, sub: string, get: () => SynthParams['ampEnv'], color: string): HTMLElement {
    const ed = envEditor(get, () => { this.ctx.markDirty(); this.ctx.sync() }, color, 112)
    if (title.includes('amplitude')) this.ampEnv = ed; else this.filtEnv = ed
    return h('div', { class: 'plate' },
      h('h4', {}, title, h('span', { class: 'spacer' }), h('span', { class: 'sub' }, sub)),
      h('div', { class: 'plate-body', style: { display: 'block' } }, ed.el))
  }

  /* ---------------- LFO ---------------- */

  private lfoPlate(n: 1 | 2, l: Lfo): HTMLElement {
    const shapes: LfoShape[] = ['sine', 'tri', 'saw', 'square', 'sh']
    const view = lfoDisplay(() => l, VIOLET, 116, 42)
    this.lfoViews.push(view)

    const rate = l.sync
      ? this.K({ label: 'DIVISION', min: 0, max: LFO_DIV_LABELS.length - 1, get: () => l.div,
                 set: (v) => { l.div = Math.round(v) }, def: 4, size: 40, color: VIOLET,
                 fmt: (v) => LFO_DIV_LABELS[clamp(Math.round(v), 0, LFO_DIV_LABELS.length - 1)] })
      : this.K({ label: 'VITESSE', min: .02, max: 24, get: () => l.rate, set: (v) => { l.rate = v },
                 def: 5, curve: 2.2, size: 40, color: VIOLET, fmt: (v) => `${v.toFixed(2)}Hz` })

    const dest = (label: string, min: number, max: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string) =>
      this.K({ label, min, max, get, set, def: 0, size: 34, color: VIOLET, fmt })

    return h('div', { class: 'plate' },
      h('h4', {}, `LFO ${n}`, h('span', { class: 'spacer' }), h('span', { class: 'sub' }, LFO_LABEL[l.shape])),
      h('div', { class: 'plate-body' },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
          view.el,
          h('div', { class: 'syn-waves' }, ...shapes.map((sh) => h('button', {
            class: `syn-wave${l.shape === sh ? ' on' : ''}`, title: LFO_LABEL[sh],
            onclick: () => { l.shape = sh; this.ctx.markDirty(); this.ctx.sync(); this.render() },
          }, icon(LFO_ICON[sh], 15)))),
          h('button', {
            class: `syn-toggle${l.sync ? ' on' : ''}`,
            dataset: { tip: l.sync ? 'La vitesse suit le tempo du projet' : 'Vitesse libre, en hertz' },
            onclick: () => { l.sync = !l.sync; this.ctx.markDirty(); this.ctx.sync(); this.render() },
          }, l.sync ? 'AU TEMPO' : 'LIBRE')),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', flex: '1 1 auto' } },
          rate,
          this.K({ label: 'MONTEE', min: 0, max: 4, get: () => l.fade, set: (v) => { l.fade = v }, def: 0,
                   curve: 2.2, size: 34, color: VIOLET, fmt: (v) => `${v.toFixed(2)}s`,
                   tip: 'Le LFO arrive progressivement apres l\'attaque' }),
          dest('→ HAUTEUR', -1200, 1200, () => l.toPitch, (v) => { l.toPitch = v }, (v) => `${v.toFixed(0)}c`),
          dest('→ FILTRE', -1, 1, () => l.toCut, (v) => { l.toCut = v }, (v) => `${Math.round(v * 100)}%`),
          dest('→ VOLUME', 0, 1, () => l.toAmp, (v) => { l.toAmp = v }, (v) => `${Math.round(v * 100)}%`),
          dest('→ STEREO', 0, 1, () => l.toPan, (v) => { l.toPan = v }, (v) => `${Math.round(v * 100)}%`),
        )))
  }

  /* ---------------- voix et effets ---------------- */

  private voicePlate(): HTMLElement {
    const p = this.p()
    return h('div', { class: 'plate' },
      h('h4', {}, 'Voix', h('span', { class: 'spacer' }), h('span', { class: 'sub' }, p.mono ? 'une note a la fois' : 'accords possibles')),
      h('div', { class: 'plate-body' },
        h('button', {
          class: `syn-toggle${p.mono ? ' on' : ''}`,
          dataset: { tip: 'En monophonique, une nouvelle note coupe la precedente et le glissando devient audible' },
          onclick: () => { p.mono = !p.mono; this.ctx.markDirty(); this.render() },
        }, p.mono ? 'MONOPHONIQUE' : 'POLYPHONIQUE'),
        this.K({ label: 'GLISSANDO', min: 0, max: 1, get: () => p.glide, set: (v) => { p.glide = v }, def: 0,
                 curve: 2.4, size: 38, fmt: (v) => `${(v * 1000).toFixed(0)}ms` }),
        this.K({ label: 'VEL → VOL', min: 0, max: 1, get: () => p.velAmp, set: (v) => { p.velAmp = v }, def: .6,
                 size: 38, fmt: (v) => `${Math.round(v * 100)}%`, tip: 'Sensibilite du volume a la force de la note' }),
        this.K({ label: 'VEL → FILTRE', min: 0, max: 1, get: () => p.velCut, set: (v) => { p.velCut = v }, def: .3,
                 size: 38, fmt: (v) => `${Math.round(v * 100)}%` }),
        this.K({ label: 'VOLUME', min: 0, max: 1.5, get: () => p.gain, set: (v) => { p.gain = v }, def: .8,
                 size: 46, ticks: 11, fmt: (v) => `${Math.round(v * 100)}` }),
      ))
  }

  private fxPlate(): HTMLElement {
    const f = this.p().fx
    return h('div', { class: 'plate' },
      h('h4', {}, 'Effets', h('span', { class: 'spacer' }), h('span', { class: 'sub' }, 'enregistres avec le preset')),
      h('div', { class: 'plate-body' },
        this.K({ label: 'SATURATION', min: 0, max: 1, get: () => f.drive, set: (v) => { f.drive = v }, def: 0, size: 38, fmt: (v) => `${Math.round(v * 100)}%` }),
        this.K({ label: 'CHORUS', min: 0, max: 1, get: () => f.chorus, set: (v) => { f.chorus = v }, def: 0, size: 38, fmt: (v) => `${Math.round(v * 100)}%` }),
        this.K({ label: 'ECHO', min: 0, max: 1, get: () => f.delay, set: (v) => { f.delay = v }, def: 0, size: 38, color: CYAN, fmt: (v) => `${Math.round(v * 100)}%` }),
        this.K({ label: 'DIVISION', min: 0, max: DLY_DIV_LABELS.length - 1, get: () => f.delayDiv, set: (v) => { f.delayDiv = Math.round(v) },
                 def: 3, size: 34, color: CYAN, fmt: (v) => DLY_DIV_LABELS[clamp(Math.round(v), 0, DLY_DIV_LABELS.length - 1)] }),
        this.K({ label: 'REINJECTION', min: 0, max: .9, get: () => f.delayFb, set: (v) => { f.delayFb = v }, def: .35, size: 34, color: CYAN, fmt: (v) => `${Math.round(v * 100)}%` }),
        this.K({ label: 'REVERBE', min: 0, max: 1, get: () => f.reverb, set: (v) => { f.reverb = v }, def: 0, size: 38, color: VIOLET, fmt: (v) => `${Math.round(v * 100)}%` }),
        this.K({ label: 'TAILLE', min: .3, max: 6, get: () => f.size, set: (v) => { f.size = v }, def: 2, curve: 1.6, size: 34, color: VIOLET, fmt: (v) => `${v.toFixed(1)}s` }),
      ))
  }

  /* ---------------- clavier ---------------- */

  private keyboard(): HTMLElement {
    const wrap = h('div', { class: 'syn-keys', dataset: { tip: 'Joue a la souris, ou au clavier de l\'ordinateur' } })
    this.keyEls.clear()
    const lo = 12 * this.octave, span = 24
    const whites: number[] = []
    for (let k = lo; k < lo + span; k++) if (!isBlack(k)) whites.push(k)
    const wW = 100 / whites.length

    whites.forEach((k, i) => {
      const el = h('div', {
        class: 'syn-key', style: { left: `${i * wW}%`, width: `${wW}%` }, dataset: { k: String(k) },
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
      const k = noteAt(e.target)
      if (k !== null) {
        // la hauteur du clic donne la force : en haut de la touche, plus doux
        const r = (e.target as HTMLElement).getBoundingClientRect()
        const v = clamp(0.35 + ((e.clientY - r.top) / r.height) * 0.65, 0.2, 1)
        this.strike(k, v)
      }
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
      h('span', {}, 'A/Q S D F G H J K pour les blanches, Z/W E T Y U pour les noires · ↑↓ pour l\'octave'),
    )
    return h('div', {}, bar, wrap)
  }

  private rebuildKeys() {
    clear(this.kbHost)
    this.kbHost.appendChild(this.keyboard())
  }

  private strike(key: number, vel = 0.85) {
    if (this.held.has(key)) return
    this.held.add(key)
    this.keyEls.get(key)?.classList.add('on')
    this.preview(key, vel)
    if (this.meta) {
      this.meta.innerHTML = ''
      this.meta.append(
        h('span', {}, 'NOTE ', h('b', {}, keyName(key))),
        h('span', {}, 'VEL ', h('b', {}, String(Math.round(vel * 127)))),
        h('span', {}, this.p().mono ? 'MONO' : 'POLY'),
      )
    }
    window.setTimeout(() => {
      this.held.delete(key)
      this.keyEls.get(key)?.classList.remove('on')
    }, 420)
  }

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
  }
}
