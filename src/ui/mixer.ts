/* ============================================================
   DJ ViDAW — MIXEUR + RACK D'EFFETS
   9 inserts, chacun avec sa chaine d'effets, ses potards, son
   vu-metre. On y route les channels depuis la tranche.
   ============================================================ */

import { h, clear } from './dom'
import { icon } from './icons'
import { knob, fader, meter } from './knob'
import { contextMenu } from './menu'
import type { Ctx } from './ctx'
import type { FxType, FxSlot } from '../core/state'
import { FX_DEFS, makeFx, clamp } from '../core/state'
import { DIV_LABELS } from '../audio/fx'

const FX_ORDER: FxType[] = ['filter', 'delay', 'reverb', 'crush', 'dist', 'chorus', 'phaser', 'eq3', 'comp', 'gate']

/* Quatre familles d'effets, quatre reperes : on repere une chaine d'un
   coup d'oeil sans lire les noms. */
const FX_FAMILY: Record<FxType, { color: string; label: string }> = {
  filter: { color: '#4ea3e8', label: 'FILTRE' },
  eq3:    { color: '#4ea3e8', label: 'FILTRE' },
  delay:  { color: '#9b8ae0', label: 'TEMPS' },
  reverb: { color: '#9b8ae0', label: 'TEMPS' },
  chorus: { color: '#9b8ae0', label: 'TEMPS' },
  phaser: { color: '#9b8ae0', label: 'TEMPS' },
  crush:  { color: '#ef9c39', label: 'MATIERE' },
  dist:   { color: '#ef9c39', label: 'MATIERE' },
  comp:   { color: '#5fa572', label: 'DYNAMIQUE' },
  gate:   { color: '#5fa572', label: 'DYNAMIQUE' },
}

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
        h('div', { class: 'spacer' }),
        h('button', {
          class: 'btn tiny', dataset: { tip: 'Envoie le channel selectionne vers la tranche choisie' },
          onclick: () => this.routeSelected(),
        }, icon('plug'), 'ROUTER LE CHANNEL ICI'),
      ),
      h('div', { style: { flex: '0 0 auto', height: '258px', overflow: 'hidden', borderBottom: '1px solid #14141a' } }, this.stripsEl),
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
        min: 0, max: 1.4, value: ins.vol, height: 118, def: 0.8, label: ins.name,
        onInput: (v) => { ins.vol = v; c.sync(); c.markDirty() },
        color: i === 0 ? '#b08fd0' : undefined,
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
        h('div', { class: 'strip-tag' },
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
      h('span', { class: 'hint' }, 'double-clic sur un potard = valeur par defaut · clic droit = son menu'),
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
        color: FX_FAMILY[slot.type].color,
        onInput: (v) => { slot.p[key] = v; c.sync(); c.markDirty() },
      }))
    }
    body.appendChild(knob({
      min: 0, max: 1, value: slot.wet, def: slot.wet, label: 'MIX', size: 38,
      color: '#c5cbd8', ticks: 9,
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

    const remove = () => {
      const ins = c.project.inserts[this.sel]
      ins.fx.splice(idx, 1)
      c.sync(); c.markDirty(); this.renderFx(); this.renderStrips()
    }

    const fam = FX_FAMILY[slot.type]
    const unit = h('div', { class: `fxunit${slot.on ? '' : ' off'}`, style: { '--fam': fam.color } },
      h('div', { class: 'fxhead' },
        h('button', {
          class: `btn xs${slot.on ? ' on' : ''}`,
          dataset: { tip: slot.on ? 'Desactive cet effet sans le retirer' : 'Reactive cet effet' },
          onclick: () => { slot.on = !slot.on; c.sync(); c.markDirty(); this.renderFx() },
        }, slot.on ? '⏻' : '○'),
        h('span', { class: 'num' }, String(idx + 1)),
        h('span', {}, FX_DEFS[slot.type].label),
        h('span', { class: 'ch-tag', style: { color: fam.color, borderColor: 'transparent', background: 'none' } }, fam.label),
        h('div', { class: 'spacer' }),
        idx > 0 ? h('button', { class: 'btn xs', onclick: () => move(-1) }, '▲') : null,
        idx < total - 1 ? h('button', { class: 'btn xs', onclick: () => move(1) }, '▼') : null,
        h('button', { class: 'btn xs', onclick: remove }, '✕'),
      ),
      body,
    )

    // Clic droit n'importe ou sur l'unite : ce que proposent les boutons,
    // sans avoir a viser un carre de neuf pixels.
    unit.addEventListener('contextmenu', (e) => {
      if ((e.target as HTMLElement).closest('.knob')) return   // le potard a son propre menu
      contextMenu(e, [
        { label: slot.on ? 'Contourner' : 'Reactiver', ico: 'plug', checked: !slot.on,
          onClick: () => { slot.on = !slot.on; c.sync(); c.markDirty(); this.renderFx() } },
        { label: 'Remettre a zero', ico: 'loop', onClick: () => {
          const d = FX_DEFS[slot.type]
          for (const [k, [, , dflt]] of Object.entries(d.params)) slot.p[k] = dflt
          c.sync(); c.markDirty(); this.renderFx()
        } },
        '-',
        { label: 'Monter', disabled: idx === 0, onClick: () => move(-1) },
        { label: 'Descendre', disabled: idx >= total - 1, onClick: () => move(1) },
        '-',
        { label: 'Retirer', ico: 'trash', danger: true, onClick: remove },
      ], { title: FX_DEFS[slot.type].label })
    })
    return unit
  }

  tick() { for (const m of this.meters) m.tick() }
}
