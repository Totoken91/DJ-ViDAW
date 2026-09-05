/* ============================================================
   DJ ViDAW — MIXEUR + RACK D'EFFETS
   9 inserts, chacun avec sa chaine d'effets, ses potards, son
   vu-metre. On y route les channels depuis la tranche.
   ============================================================ */

import { h, clear } from './dom'
import { icon } from './icons'
import { knob, fader, meter } from './knob'
import type { Ctx } from './ctx'
import type { FxType, FxSlot } from '../core/state'
import { FX_DEFS, makeFx, clamp } from '../core/state'
import { DIV_LABELS } from '../audio/fx'

const FX_ORDER: FxType[] = ['filter', 'delay', 'reverb', 'crush', 'dist', 'chorus', 'phaser', 'eq3', 'comp', 'gate']

export class Mixer {
  el: HTMLElement
  private stripsEl: HTMLElement
  private fxEl: HTMLElement
  private meters: { tick: () => void }[] = []
  sel = 0

  constructor(private ctx: Ctx) {
    this.stripsEl = h('div', { class: 'mixer' })
    this.fxEl = h('div', { class: 'fxrack' })
    this.el = h('div', { class: 'rack' },
      h('div', { class: 'bar thin' },
        h('span', { class: 'hint' }, 'clique une tranche puis ajoute des effets en dessous'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn tiny', onclick: () => this.routeSelected() }, icon('plug'), 'ROUTER LE CHANNEL ICI'),
      ),
      h('div', { style: { flex: '0 0 auto', height: '246px', overflow: 'hidden', borderBottom: '1px solid #14141a' } }, this.stripsEl),
      this.fxEl,
    )
    this.render()
  }

  private routeSelected() {
    const ch = this.ctx.channel(this.ctx.selected)
    if (!ch) return
    ch.insert = this.sel
    this.ctx.sync(); this.ctx.markDirty()
    this.ctx.toast(`${ch.name} → ${this.sel === 0 ? 'MASTER' : `INS ${this.sel}`}`)
    this.render()
  }

  render() {
    this.renderStrips()
    this.renderFx()
  }

  private renderStrips() {
    const c = this.ctx
    clear(this.stripsEl)
    this.meters = []
    c.project.inserts.forEach((ins, i) => {
      const g = c.engine.graph
      const an = g?.inserts[i]?.analyser ?? null
      const m = meter(an, 9, 118)
      this.meters.push(m)

      const chNames = c.project.channels.filter((ch) => ch.insert === i).map((ch) => ch.name)

      const f = fader({
        min: 0, max: 1.4, value: ins.vol, height: 118,
        onInput: (v) => { ins.vol = v; c.sync(); c.markDirty() },
        color: i === 0 ? '#ff4fd8' : undefined,
      })

      const strip = h('div', {
        class: `strip${i === this.sel ? ' sel' : ''}${i === 0 ? ' master' : ''}`,
        onclick: () => { this.sel = i; this.render() },
      },
        h('div', { class: 'strip-name', title: chNames.join(', ') || 'aucun channel' }, ins.name),
        knob({
          min: -1, max: 1, value: ins.pan, def: 0, label: 'PAN', size: 26,
          format: (v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `G${Math.round(-v * 100)}` : `D${Math.round(v * 100)}`),
          onInput: (v) => { ins.pan = v; c.sync(); c.markDirty() },
        }),
        h('div', { class: 'strip-row' }, f, m.el),
        h('button', {
          class: `btn xs${ins.mute ? ' on' : ''}`,
          onclick: (e: Event) => {
            e.stopPropagation()
            ins.mute = !ins.mute
            c.sync(); c.markDirty(); this.render()
          },
        }, ins.mute ? 'MUET' : 'ON'),
        h('div', { class: 'ch-tag', style: { textAlign: 'center', width: '100%' } },
          ins.fx.length ? `${ins.fx.length} FX` : chNames.length ? `${chNames.length} CH` : '—'),
      )
      this.stripsEl.appendChild(strip)
    })
  }

  private renderFx() {
    const c = this.ctx
    const ins = c.project.inserts[this.sel]
    clear(this.fxEl)

    const add = h('select', { class: 'sel', onchange: (e: Event) => {
      const el = e.target as HTMLSelectElement
      const t = el.value as FxType
      el.value = ''
      if (!t) return
      if (ins.fx.length >= 6) { c.toast('6 effets max par insert, calme-toi.'); return }
      ins.fx.push(makeFx(t))
      c.sync(); c.markDirty(); this.renderFx(); this.renderStrips()
    } },
      h('option', { value: '' }, '+ AJOUTER UN EFFET'),
      ...FX_ORDER.map((t) => h('option', { value: t }, FX_DEFS[t].label)),
    )

    this.fxEl.appendChild(h('div', { class: 'bar thin', style: { background: 'none', border: 'none', padding: '0 0 4px' } },
      h('span', { class: 'chrome', style: { fontSize: '15px' } }, ins.name),
      add,
      h('div', { class: 'spacer' }),
      h('span', { class: 'hint' }, 'double-clic sur un potard = valeur par defaut'),
    ))

    if (!ins.fx.length) {
      this.fxEl.appendChild(h('div', { class: 'hint', style: { textAlign: 'center', padding: '18px' } },
        'Insert vide. Ajoute un BITCRUSH avec le menu ci-dessus, tu vas voir, c\'est rigolo.'))
      return
    }

    ins.fx.forEach((slot, idx) => this.fxEl.appendChild(this.fxUnit(slot, idx, ins.fx.length)))
  }

  private fxUnit(slot: FxSlot, idx: number, total: number): HTMLElement {
    const c = this.ctx
    const def = FX_DEFS[slot.type]
    const body = h('div', { class: 'fxbody' })

    for (const [key, [min, max, dflt, label]] of Object.entries(def.params)) {
      // parametres a choix discret : on affiche des libelles
      let format: ((v: number) => string) | undefined
      if (slot.type === 'delay' && key === 'time') format = (v) => DIV_LABELS[clamp(Math.round(v), 0, DIV_LABELS.length - 1)]
      if (slot.type === 'filter' && key === 'mode') format = (v) => ['LP', 'HP', 'BP'][clamp(Math.round(v), 0, 2)]
      if (slot.type === 'delay' && key === 'ping') format = (v) => (v > 0.5 ? 'PING' : 'DUAL')
      if (slot.type === 'gate' && key === 'rate') format = (v) => ['1/1', '1/2', '1/4', '1/8', '1/16'][clamp(Math.round(v), 0, 4)]
      const curve = (key === 'freq' || key === 'tone' || key === 'damp' || key === 'cutoff') ? 2.6 : 1
      body.appendChild(knob({
        min, max, value: slot.p[key], def: dflt, label, size: 36, curve, format,
        color: ['#00ff9c', '#ff4fd8', '#4fe9ff', '#ffd23d'][idx % 4],
        onInput: (v) => { slot.p[key] = v; c.sync(); c.markDirty() },
      }))
    }
    body.appendChild(knob({
      min: 0, max: 1, value: slot.wet, def: slot.wet, label: 'MIX', size: 36,
      color: '#ffffff',
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => { slot.wet = v; c.sync(); c.markDirty() },
    }))

    const move = (d: number) => {
      const ins = c.project.inserts[this.sel]
      const j = idx + d
      if (j < 0 || j >= ins.fx.length) return
      const t = ins.fx[idx]; ins.fx[idx] = ins.fx[j]; ins.fx[j] = t
      c.sync(); c.markDirty(); this.renderFx()
    }

    return h('div', { class: `fxunit${slot.on ? '' : ' off'}` },
      h('div', { class: 'fxhead' },
        h('button', {
          class: `btn xs${slot.on ? ' on' : ''}`,
          onclick: () => { slot.on = !slot.on; c.sync(); c.markDirty(); this.renderFx() },
        }, slot.on ? '⏻' : '○'),
        h('span', {}, `${idx + 1}. ${FX_DEFS[slot.type].label}`),
        h('div', { class: 'spacer' }),
        idx > 0 ? h('button', { class: 'btn xs', onclick: () => move(-1) }, '▲') : null,
        idx < total - 1 ? h('button', { class: 'btn xs', onclick: () => move(1) }, '▼') : null,
        h('button', {
          class: 'btn xs', onclick: () => {
            const ins = c.project.inserts[this.sel]
            ins.fx.splice(idx, 1)
            c.sync(); c.markDirty(); this.renderFx(); this.renderStrips()
          },
        }, '✕'),
      ),
      body,
    )
  }

  tick() { for (const m of this.meters) m.tick() }
}
