/* ============================================================
   DJ ViDAW — EDITEUR DE CHANNEL
   S'adapte au type : percussion synthetique, sampler (avec editeur
   de forme d'onde et decoupe), ou synthetiseur soustractif.
   ============================================================ */

import { h, clear, drag } from './dom'
import { icon } from './icons'
import { knob } from './knob'
import type { Ctx } from './ctx'
import type { Channel } from '../core/state'
import { clamp, defaultDrum, keyName, uid, patternSteps, DRUM_KINDS } from '../core/state'
import { detectSlices, guessBpm } from '../audio/samples'
import { SynthPanel } from './synth'


export class ChannelEditor {
  el: HTMLElement
  private body: HTMLElement
  private waveCv: HTMLCanvasElement | null = null
  private synth: SynthPanel | null = null
  chId = ''

  constructor(private ctx: Ctx) {
    // colonne flex : l'en-tete garde sa taille, le panneau prend le reste et
    // gere son propre defilement (le synthetiseur a un clavier a garder visible)
    this.body = h('div', {
      style: { flex: '1 1 auto', minHeight: '0', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    })
    this.el = h('div', { class: 'rack' }, this.body)
  }

  show(id: string) { this.chId = id; this.render() }

  render() {
    const c = this.ctx
    const ch = c.channel(this.chId) ?? c.channel(c.selected)
    clear(this.body)
    if (!ch) { this.body.appendChild(h('div', { class: 'hint' }, 'Aucun channel selectionne.')); return }
    this.chId = ch.id

    const head = this.header(ch)
    head.style.flex = '0 0 auto'
    head.style.margin = '8px 8px 0'
    this.body.appendChild(head)

    if (ch.type === 'synth') {
      const panel = this.synthPanel(ch)
      panel.style.flex = '1 1 auto'
      panel.style.minHeight = '0'
      this.body.appendChild(panel)
      return
    }
    const scroll = h('div', { style: { flex: '1 1 auto', minHeight: '0', overflow: 'auto', padding: '8px' } },
      ch.type === 'drum' ? this.drumPanel(ch) : this.samplerPanel(ch))
    this.body.appendChild(scroll)
  }

  private header(ch: Channel): HTMLElement {
    const c = this.ctx
    const name = h('input', {
      class: 'txt', value: ch.name, style: { width: '150px' },
      oninput: (e: Event) => { ch.name = (e.target as HTMLInputElement).value.slice(0, 28); c.markDirty(); c.refresh('rack') },
    })
    const routing = h('select', { class: 'sel', onchange: (e: Event) => {
      ch.insert = Number((e.target as HTMLSelectElement).value)
      c.sync(); c.markDirty(); c.refresh('mixer')
    } }, ...c.project.inserts.map((i) => h('option', { value: String(i.id), selected: i.id === ch.insert }, i.name)))

    return h('div', { class: 'bar', style: { borderRadius: '4px', marginBottom: '8px' } },
      h('span', { class: 'ch-led', style: { background: ch.color, color: ch.color } }),
      name,
      h('div', { class: 'sep' }),
      knob({ min: 0, max: 1.4, value: ch.vol, def: 0.85, label: 'VOL', size: 34, color: ch.color,
        format: (v) => `${Math.round(v * 100)}`, onInput: (v) => { ch.vol = v; c.sync(); c.markDirty() } }),
      knob({ min: -1, max: 1, value: ch.pan, def: 0, label: 'PAN', size: 34, color: ch.color,
        format: (v) => (Math.abs(v) < .02 ? 'C' : v < 0 ? `G${Math.round(-v * 100)}` : `D${Math.round(v * 100)}`),
        onInput: (v) => { ch.pan = v; c.sync(); c.markDirty() } }),
      knob({ min: -24, max: 24, value: ch.pitch, def: 0, label: 'PITCH', size: 34, color: ch.color,
        format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}`, onInput: (v) => { ch.pitch = Math.round(v); c.markDirty() } }),
      h('div', { class: 'sep' }),
      h('span', { class: 'hint' }, 'SORTIE'), routing,
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn tiny go', onclick: () => void c.engine.preview(ch.id, 60, 4, 1) }, icon('play'), 'TESTER'),
    )
  }

  /* ---------------- percussions ---------------- */
  private drumPanel(ch: Channel): HTMLElement {
    const c = this.ctx
    const d = ch.drum!
    const kinds = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '8px' } },
      ...DRUM_KINDS.map((k) => h('button', {
        class: `btn tiny${d.kind === k ? ' on' : ''}`,
        onclick: () => {
          const keep = { tune: d.tune }
          Object.assign(d, defaultDrum(k), keep)
          c.markDirty(); this.render(); void c.engine.preview(ch.id, 60, 2, 1)
        },
      }, k.toUpperCase())))

    const K = (label: string, min: number, max: number, get: () => number, set: (v: number) => void, def: number, curve = 1) =>
      knob({ min, max, value: get(), def, label, size: 44, curve, color: ch.color,
        onInput: (v) => { set(v); c.markDirty(); void c.engine.preview(ch.id, 60, 2, 1) } })

    return h('div', {},
      h('div', { class: 'chrome', style: { fontSize: '17px', marginBottom: '6px' } }, 'PERCUSSION SYNTHETIQUE'),
      kinds,
      h('div', { class: 'fxunit' },
        h('div', { class: 'fxhead' }, h('span', {}, 'MOTEUR')),
        h('div', { class: 'fxbody' },
          K('TUNE', -24, 24, () => d.tune, (v) => { d.tune = v }, 0),
          K('DECAY', 0.02, 2, () => d.decay, (v) => { d.decay = v }, 0.3, 2),
          K('TONE', 0, 1, () => d.tone, (v) => { d.tone = v }, 0.5),
          K('SNAP', 0, 1, () => d.snap, (v) => { d.snap = v }, 0.5),
          K('DRIVE', 0, 1, () => d.drive, (v) => { d.drive = v }, 0.15),
        ),
      ),
      h('div', { class: 'hint' }, 'Astuce : monte DRIVE et baisse TONE sur un KICK, tu obtiens un truc qui tache.'),
    )
  }

  /* ---------------- synthetiseur ----------------
     La face avant complete vit dans son propre module : elle est trop
     riche pour tenir dans l'editeur generique de channel. */
  private synthPanel(ch: Channel): HTMLElement {
    if (!this.synth) this.synth = new SynthPanel(this.ctx, ch)
    else this.synth.setChannel(ch)
    return this.synth.el
  }

  /* ---------------- sampler ---------------- */
  private samplerPanel(ch: Channel): HTMLElement {
    const c = this.ctx
    const sp = ch.sampler!
    const meta = sp.sampleId ? c.samples.meta(sp.sampleId) : undefined

    const pick = h('select', { class: 'sel', onchange: (e: Event) => {
      const v = (e.target as HTMLSelectElement).value
      sp.sampleId = v || null
      if (v) {
        const m = c.samples.meta(v)
        if (m) { sp.end = 1; sp.start = 0; sp.slices = []; sp.bpmOrigin = guessBpm(m.buffer) }
      }
      c.markDirty(); this.render()
    } },
      h('option', { value: '' }, '— aucun —'),
      ...c.samples.list().map((s) => h('option', { value: s.id, selected: s.id === sp.sampleId }, s.name)),
    )

    const cv = h('canvas', { style: { width: '100%', height: '150px', display: 'block', cursor: 'crosshair', touchAction: 'none' } })
    this.waveCv = cv

    const wrap = h('div', {
      style: {
        position: 'relative', border: '1px solid #0d0d12', borderRadius: '3px',
        background: '#0d1218', marginBottom: '8px', overflow: 'hidden',
      },
    }, cv)

    // Interaction : glisser = start/end, alt+clic = poser une slice
    let mode: 'start' | 'end' | null = null
    drag(cv, (_dx, _dy, e) => {
      const r = cv.getBoundingClientRect()
      const x = clamp((e.clientX - r.left) / r.width, 0, 1)
      if (mode === 'start') sp.start = Math.min(x, sp.end - 0.002)
      else if (mode === 'end') sp.end = Math.max(x, sp.start + 0.002)
      c.markDirty(); this.paintWave(ch)
    }, (e) => {
      const r = cv.getBoundingClientRect()
      const x = clamp((e.clientX - r.left) / r.width, 0, 1)
      if (e.altKey) {
        sp.slices = [...sp.slices, x].sort((a, b) => a - b)
        c.markDirty(); this.paintWave(ch); this.render()
        return false
      }
      mode = Math.abs(x - sp.start) < Math.abs(x - sp.end) ? 'start' : 'end'
      return true
    }, () => { mode = null })

    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const r = cv.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width
      const i = sp.slices.findIndex((s) => Math.abs(s - x) < 0.02)
      if (i >= 0) { sp.slices.splice(i, 1); c.markDirty(); this.paintWave(ch); this.render() }
    })

    const K = (label: string, min: number, max: number, get: () => number, set: (v: number) => void, def: number, curve = 1) =>
      knob({ min, max, value: get(), def, label, size: 40, curve, color: ch.color,
        onInput: (v) => { set(v); c.markDirty(); this.paintWave(ch) } })

    const chopN = (n: number) => {
      sp.slices = Array.from({ length: n - 1 }, (_, i) => (i + 1) / n)
      c.markDirty(); this.paintWave(ch); this.render()
    }

    const spread = () => {
      if (!sp.slices.length) { c.toast('Fais d\'abord des chops.'); return }
      const pat = c.project.patterns.find((p) => p.id === c.project.currentPattern)!
      const steps = patternSteps(pat)
      pat.notes = pat.notes.filter((n) => n.ch !== ch.id)
      const count = sp.slices.length + 1
      for (let t = 0; t < steps; t++) {
        pat.notes.push({ id: uid('n'), ch: ch.id, t, len: 1, key: 60, vel: .9, slice: t % count })
      }
      c.markDirty(); c.refresh('all')
      c.say('Chops etales sur le motif. Maintenant reordonne-les au hasard, c\'est la que ca devient drole.')
    }

    const shuffleSlices = () => {
      const pat = c.project.patterns.find((p) => p.id === c.project.currentPattern)!
      const mine = pat.notes.filter((n) => n.ch === ch.id)
      if (!mine.length) { c.toast('Aucune note a melanger.'); return }
      const count = sp.slices.length + 1
      for (const n of mine) n.slice = Math.floor(Math.random() * count)
      c.markDirty(); c.refresh('all')
    }

    requestAnimationFrame(() => this.paintWave(ch))

    return h('div', {},
      h('div', { class: 'chrome', style: { fontSize: '17px', marginBottom: '6px' } }, 'SAMPLER'),
      h('div', { class: 'bar thin', style: { borderRadius: '3px', marginBottom: '6px' } },
        h('span', { class: 'hint' }, 'SAMPLE'), pick,
        meta ? h('span', { class: 'pill' }, `${meta.duration.toFixed(2)}s · ${meta.rate}Hz · ${meta.channels}ch`) : null,
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn tiny', onclick: () => c.openWindow('browser') }, icon('folder'), 'IMPORTER'),
      ),
      wrap,
      h('div', { class: 'bar thin', style: { borderRadius: '3px', marginBottom: '6px' } },
        h('span', { class: 'hint' }, 'CHOP'),
        h('button', { class: 'btn tiny', onclick: () => chopN(4) }, '÷4'),
        h('button', { class: 'btn tiny', onclick: () => chopN(8) }, '÷8'),
        h('button', { class: 'btn tiny', onclick: () => chopN(16) }, '÷16'),
        h('button', {
          class: 'btn tiny hot', onclick: () => {
            if (!meta) return
            sp.slices = detectSlices(meta.buffer, 0.5, 32)
            c.markDirty(); this.paintWave(ch); this.render()
            c.toast(`${sp.slices.length} transitoires detectes`)
          },
        }, icon('scissors'), 'AUTO'),
        h('button', { class: 'btn tiny', onclick: () => { sp.slices = []; c.markDirty(); this.paintWave(ch); this.render() } }, '✕ RESET'),
        h('div', { class: 'sep' }),
        h('button', { class: 'btn tiny go', onclick: spread }, '⇉ ETALER SUR LE MOTIF'),
        h('button', { class: 'btn tiny', onclick: shuffleSlices }, icon('dice'), 'MELANGER'),
        h('span', { class: 'pill' }, `${sp.slices.length + (sp.sampleId ? 1 : 0)} tranches`),
      ),
      h('div', { class: 'fxunit' },
        h('div', { class: 'fxhead' }, h('span', {}, 'LECTURE')),
        h('div', { class: 'fxbody' },
          K('DEBUT', 0, 1, () => sp.start, (v) => { sp.start = Math.min(v, sp.end - .002) }, 0),
          K('FIN', 0, 1, () => sp.end, (v) => { sp.end = Math.max(v, sp.start + .002) }, 1),
          K('ATTAQUE', 0, .5, () => sp.attack, (v) => { sp.attack = v }, .001, 2.4),
          K('RELACHE', .002, .8, () => sp.release, (v) => { sp.release = v }, .02, 2),
          K('NOTE BASE', 24, 96, () => sp.rootKey, (v) => { sp.rootKey = Math.round(v) }, 60, 1),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px', paddingTop: '4px' } },
            h('label', { class: 'check' },
              h('input', { type: 'checkbox', checked: sp.reverse, onchange: (e: Event) => { sp.reverse = (e.target as HTMLInputElement).checked; c.markDirty(); this.paintWave(ch) } }),
              'INVERSE (lecture a l\'envers)'),
            h('label', { class: 'check' },
              h('input', { type: 'checkbox', checked: sp.loop, onchange: (e: Event) => { sp.loop = (e.target as HTMLInputElement).checked; c.markDirty() } }),
              'BOUCLE'),
            h('label', { class: 'check' },
              h('input', { type: 'checkbox', checked: sp.stretch, onchange: (e: Event) => { sp.stretch = (e.target as HTMLInputElement).checked; c.markDirty() } }),
              'CALER AU TEMPO'),
            h('div', { style: { display: 'flex', gap: '4px', alignItems: 'center' } },
              h('span', { class: 'knob-label' }, 'BPM SRC'),
              h('input', {
                class: 'txt', type: 'number', value: String(Math.round(sp.bpmOrigin)), style: { width: '54px' },
                oninput: (e: Event) => { sp.bpmOrigin = clamp(Number((e.target as HTMLInputElement).value) || 120, 20, 300); c.markDirty() },
              })),
          ),
        ),
      ),
      h('div', { class: 'hint' },
        `Note de base : ${keyName(sp.rootKey)}. Dans le piano roll, jouer plus haut accelere le sample. ` +
        'Glisse sur la forme d\'onde pour DEBUT/FIN, alt+clic pour poser une tranche, clic droit pour l\'enlever.'),
    )
  }

  private paintWave(ch: Channel) {
    const cv = this.waveCv
    if (!cv) return
    const sp = ch.sampler
    if (!sp) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = cv.clientWidth || 600, hh = cv.clientHeight || 150
    cv.width = Math.floor(w * dpr); cv.height = Math.floor(hh * dpr)
    const g = cv.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)

    g.fillStyle = '#0d1218'; g.fillRect(0, 0, w, hh)
    // quadrillage tramé
    g.fillStyle = 'rgba(255,255,255,.04)'
    for (let x = 0; x < w; x += 8) g.fillRect(x, 0, 1, hh)
    for (let y = 0; y < hh; y += 8) g.fillRect(0, y, w, 1)

    const meta = sp.sampleId ? this.ctx.samples.meta(sp.sampleId) : undefined
    if (!meta) {
      g.fillStyle = '#4d5b6b'; g.font = 'bold 12px Tahoma, sans-serif'
      g.textAlign = 'center'
      g.fillText('AUCUN SAMPLE — importe un fichier dans le navigateur', w / 2, hh / 2)
      g.textAlign = 'left'
      return
    }

    const peaks = meta.peaks
    const cols = peaks.length / 2
    const mid = hh / 2
    // forme d'onde
    for (let x = 0; x < w; x++) {
      const i = Math.floor((x / w) * cols)
      const mn = peaks[i * 2], mx = peaks[i * 2 + 1]
      const y0 = mid - mx * mid * 0.92
      const y1 = mid - mn * mid * 0.92
      const inside = (x / w) >= sp.start && (x / w) <= sp.end
      g.fillStyle = inside ? ch.color : 'rgba(120,130,150,.4)'
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0))
    }
    // ligne mediane
    g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(0, mid, w, 1)

    // zones exclues
    g.fillStyle = 'rgba(0,0,0,.55)'
    g.fillRect(0, 0, sp.start * w, hh)
    g.fillRect(sp.end * w, 0, w - sp.end * w, hh)

    // marqueurs debut/fin
    for (const [pos, col, label] of [[sp.start, '#00ff9c', 'S'], [sp.end, '#ff4fd8', 'E']] as [number, string, string][]) {
      const x = pos * w
      g.fillStyle = col; g.fillRect(x - 1, 0, 2, hh)
      g.fillRect(x - 1, 0, 12, 12)
      g.fillStyle = '#000'; g.font = 'bold 9px Tahoma, sans-serif'
      g.fillText(label, x + 2, 9)
    }

    // tranches
    g.font = 'bold 8px Tahoma, sans-serif'
    sp.slices.forEach((s, i) => {
      const x = s * w
      g.fillStyle = '#ffd23d'
      g.fillRect(x, 0, 1, hh)
      g.fillRect(x, hh - 12, 13, 12)
      g.fillStyle = '#241a00'
      g.fillText(String(i + 1), x + 3, hh - 3)
    })
    if (sp.slices.length) {
      g.fillStyle = '#ffd23d'
      g.fillRect(0, hh - 12, 13, 12)
      g.fillStyle = '#241a00'; g.fillText('0', 4, hh - 3)
    }

    if (sp.reverse) {
      g.fillStyle = 'rgba(255,79,216,.85)'; g.font = 'bold 11px Tahoma, sans-serif'
      g.fillText('◀ INVERSE', 8, 18)
    }
  }
}
