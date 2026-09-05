/* ============================================================
   DJ ViDAW — BARRE DE TRANSPORT
   Le cockpit : lecture, tempo, swing, master, motif courant,
   oscilloscope et bandeau defilant obligatoire.
   ============================================================ */

import { h, drag, clear } from './dom'
import { knob } from './knob'
import { Scope } from './scope'
import type { Ctx } from './ctx'
import { clamp } from '../core/state'

export class Transport {
  el: HTMLElement
  scope = new Scope()
  private playBtn: HTMLElement
  private songBtn: HTMLElement
  private bpmEl: HTMLElement
  private patSel: HTMLSelectElement
  private posEl: HTMLElement

  constructor(private ctx: Ctx, onExport: () => void, onRec: () => void) {
    const c = ctx

    this.playBtn = h('button', { class: 'btn go', onclick: () => this.togglePlay('pattern'), title: 'F5' }, '▶ MOTIF')
    this.songBtn = h('button', { class: 'btn', onclick: () => this.togglePlay('song'), title: 'F6' }, '▶▶ CHANSON')
    const stopBtn = h('button', { class: 'btn', onclick: () => { c.engine.stop(); this.paint() }, title: 'Stop' }, '⏹')
    const recBtn = h('button', { class: 'btn rec', onclick: onRec, title: 'Enregistre la sortie en direct' }, '⏺ REC')

    this.bpmEl = h('div', { class: 'lcd', title: 'Glisse pour changer le tempo' },
      h('span', { id: 'bpm-val' }, String(c.project.bpm)), h('small', {}, 'BPM'))
    let bpm0 = 0
    drag(this.bpmEl, (_dx, dy, e) => {
      const f = e.shiftKey ? 0.12 : 0.5
      c.project.bpm = clamp(Math.round(bpm0 - dy * f), 40, 250)
      this.paint(); c.sync(); c.markDirty()
    }, () => { bpm0 = c.project.bpm })
    this.bpmEl.addEventListener('wheel', (e) => {
      e.preventDefault()
      c.project.bpm = clamp(c.project.bpm - Math.sign(e.deltaY), 40, 250)
      this.paint(); c.sync(); c.markDirty()
    }, { passive: false })
    this.bpmEl.addEventListener('dblclick', () => { c.project.bpm = 128; this.paint(); c.sync(); c.markDirty() })

    this.posEl = h('div', { class: 'lcd cyan', style: { cursor: 'default' } }, h('span', {}, '001:01'))

    this.patSel = h('select', { class: 'sel', style: { minWidth: '110px' }, onchange: (e: Event) => {
      c.project.currentPattern = (e.target as HTMLSelectElement).value
      c.refresh('all')
    } })

    const swing = knob({
      min: 0, max: 0.5, value: c.project.swing, def: 0.08, label: 'SWING', size: 34,
      color: '#ff4fd8', format: (v) => `${Math.round(v * 200)}%`,
      onInput: (v) => { c.project.swing = v; c.markDirty() },
    })
    const master = knob({
      min: 0, max: 1.2, value: c.project.masterVol, def: 0.8, label: 'MASTER', size: 38,
      color: '#ffd23d', format: (v) => `${Math.round(v * 100)}`,
      onInput: (v) => { c.project.masterVol = v; c.sync(); c.markDirty() },
    })

    const scopeBox = h('div', {
      style: { width: '150px', height: '46px', flex: '0 0 150px', border: '1px solid #0a0a0e', borderRadius: '3px', overflow: 'hidden' },
    }, this.scope.el)
    this.scope.el.style.width = '100%'
    this.scope.el.style.height = '100%'

    this.el = h('div', { id: 'topbar' },
      h('div', { class: 'tb-logo' },
        h('span', { class: 'tb-logo-1' }, 'DJ'),
        h('span', { class: 'tb-logo-2' }, 'ViDAW'),
      ),
      h('div', { class: 'sep' }),
      this.playBtn, this.songBtn, stopBtn, recBtn,
      h('div', { class: 'sep' }),
      this.bpmEl, this.posEl,
      swing, master,
      h('div', { class: 'sep' }),
      h('span', { class: 'hint' }, 'MOTIF'), this.patSel,
      h('div', { class: 'sep' }),
      scopeBox,
      h('div', { class: 'marquee' }, h('span', {},
        '★ DJ ViDAW v1.0 ★ le studio qui tient dans un onglet ★ concu par DJ Viteau dans un garage a Aulnay ★ ' +
        'compatible Pentium III ★ ne pas ecouter a plus de 11 sur 10 ★ appuyez sur ESPACE pour lancer le son ★ ' +
        'meilleur vu en 1024x768 ★ signez mon livre d\'or ★')),
      h('button', { class: 'btn hot', onclick: onExport, title: 'Rendu WAV' }, '💾 EXPORTER'),
    )

    this.refreshPatterns()
    this.paint()
  }

  refreshPatterns() {
    const c = this.ctx
    clear(this.patSel)
    for (const p of c.project.patterns) {
      this.patSel.appendChild(h('option', { value: p.id, selected: p.id === c.project.currentPattern }, p.name))
    }
  }

  private togglePlay(mode: 'pattern' | 'song') {
    const e = this.ctx.engine
    if (e.playing && e.mode === mode) e.stop()
    else { e.stop(); void e.play(mode) }
    setTimeout(() => this.paint(), 30)
  }

  paint() {
    const c = this.ctx
    const e = c.engine
    const bpmSpan = this.bpmEl.querySelector('#bpm-val')
    if (bpmSpan) bpmSpan.textContent = String(c.project.bpm)
    this.playBtn.classList.toggle('on', e.playing && e.mode === 'pattern')
    this.songBtn.classList.toggle('on', e.playing && e.mode === 'song')
    this.playBtn.textContent = e.playing && e.mode === 'pattern' ? '⏸ MOTIF' : '▶ MOTIF'
    this.songBtn.textContent = e.playing && e.mode === 'song' ? '⏸ CHANSON' : '▶▶ CHANSON'
  }

  setPosition(step: number) {
    const bar = Math.floor(step / 16) + 1
    const beat = Math.floor((step % 16) / 4) + 1
    const s = this.posEl.querySelector('span')
    if (s) s.textContent = `${String(bar).padStart(3, '0')}:${String(beat).padStart(2, '0')}`
  }
}
