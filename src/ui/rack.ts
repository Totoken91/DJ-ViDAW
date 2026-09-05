/* ============================================================
   DJ ViDAW — CHANNEL RACK (le sequenceur pas-a-pas)
   Clic gauche : pose/retire un pas. Clic droit : reglage de la
   velocite. Molette sur un pas : velocite aussi.
   ============================================================ */

import { h, clear } from './dom'
import { icon } from './icons'
import type { Ctx } from './ctx'
import type { Channel, Note, DrumKind } from '../core/state'
import { uid, patternSteps, makeChannel, clamp, DRUM_KINDS } from '../core/state'

export class Rack {
  el: HTMLElement
  private scroll: HTMLElement
  private rows = new Map<string, { row: HTMLElement; steps: HTMLElement[] }>()
  private lastCol = -1

  constructor(private ctx: Ctx, private onOpenRoll: (chId: string) => void) {
    this.scroll = h('div', { class: 'rack-scroll' })
    this.el = h('div', { class: 'rack' }, this.buildBar(), this.scroll)
    this.render()
  }

  private buildBar(): HTMLElement {
    const c = this.ctx
    const addMenu = h('select', { class: 'sel', onchange: (e: Event) => {
      const v = (e.target as HTMLSelectElement).value
      if (!v) return
      ;(e.target as HTMLSelectElement).value = ''
      this.addChannel(v)
    } },
      h('option', { value: '' }, '+ AJOUTER...'),
      h('optgroup', { label: 'Percussions' }, ...DRUM_KINDS.map((k) => h('option', { value: `drum:${k}` }, k.toUpperCase()))),
      h('option', { value: 'synth' }, 'SYNTHE'),
      h('option', { value: 'sampler' }, 'SAMPLER (vide)'),
    )

    return h('div', { class: 'bar thin' },
      addMenu,
      h('button', { class: 'btn tiny', onclick: () => this.randomize() }, icon('dice'), 'HASARD'),
      h('button', { class: 'btn tiny', onclick: () => this.clearPattern() }, icon('broom'), 'VIDER'),
      h('div', { class: 'sep' }),
      h('span', { class: 'hint' }, 'clic = pas · clic droit/molette = velocite · double-clic nom = piano roll'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn tiny', onclick: () => this.setBars(-1) }, '−1 MES'),
      h('span', { class: 'pill', id: 'rack-bars' }, '1 MES'),
      h('button', { class: 'btn tiny', onclick: () => this.setBars(1) }, '+1 MES'),
      h('div', { class: 'sep' }),
      h('button', { class: 'btn tiny', onclick: () => c.openWindow('mixer') }, icon('mixer'), 'MIXEUR'),
    )
  }

  private pattern() {
    return this.ctx.project.patterns.find((p) => p.id === this.ctx.project.currentPattern)!
  }

  private setBars(d: number) {
    const p = this.pattern()
    p.bars = clamp(p.bars + d, 1, 8)
    // on coupe les notes qui depassent
    const max = patternSteps(p)
    p.notes = p.notes.filter((n) => n.t < max)
    this.ctx.markDirty()
    this.ctx.refresh('all')
  }

  private addChannel(v: string) {
    const c = this.ctx
    const i = c.project.channels.length
    let ch: Channel
    if (v.startsWith('drum:')) {
      const kind = v.slice(5) as DrumKind
      ch = makeChannel('drum', kind.toUpperCase(), i, kind)
    } else if (v === 'synth') ch = makeChannel('synth', `SYNTHE ${i + 1}`, i)
    else ch = makeChannel('sampler', `SAMPLER ${i + 1}`, i)
    c.project.channels.push(ch)
    c.markDirty(); c.sync(); c.refresh('all')
    c.selectChannel(ch.id)
  }

  private clearPattern() {
    this.pattern().notes = []
    this.ctx.markDirty()
    this.render()
  }

  /** Remplit le motif au hasard, avec des densites plausibles par instrument. */
  randomize() {
    const p = this.pattern()
    const steps = patternSteps(p)
    p.notes = []
    for (const ch of this.ctx.project.channels) {
      if (ch.type === 'sampler' && !ch.sampler?.sampleId) continue
      const kind = ch.drum?.kind
      const density = kind === 'kick' ? 0.24 : kind === 'hat' ? 0.55 : kind === 'clap' || kind === 'snare' ? 0.16 : 0.2
      for (let t = 0; t < steps; t++) {
        const onBeat = t % 4 === 0
        const chance = density * (onBeat ? 2.1 : 0.75)
        if (Math.random() < chance) {
          const key = ch.type === 'synth'
            ? 60 + [0, 3, 5, 7, 10][Math.floor(Math.random() * 5)] - (Math.random() < 0.4 ? 12 : 0)
            : 60
          p.notes.push({ id: uid('n'), ch: ch.id, t, len: ch.type === 'synth' ? 2 : 1, key, vel: 0.5 + Math.random() * 0.5, slice: -1 })
        }
      }
    }
    this.ctx.markDirty()
    this.ctx.say('Genere par mon cerveau aleatoire. Si c\'est nul, refais-le.')
    this.render()
  }

  /* ---------------- rendu ---------------- */

  render() {
    const c = this.ctx
    const pat = this.pattern()
    if (!pat) return
    const steps = patternSteps(pat)
    const barsPill = this.el.querySelector('#rack-bars')
    if (barsPill) barsPill.textContent = `${pat.bars} MES`

    clear(this.scroll)
    this.rows.clear()

    for (const ch of c.project.channels) {
      const led = h('span', { class: 'ch-led', style: { background: ch.color, color: ch.color } })
      const nameEl = h('span', { class: 'ch-name' }, ch.name)
      const btn = h('div', {
        class: 'ch-btn',
        onclick: () => c.selectChannel(ch.id),
        ondblclick: () => this.onOpenRoll(ch.id),
        oncontextmenu: (e: Event) => { e.preventDefault(); this.renameChannel(ch) },
      }, led, nameEl, h('span', { class: 'ch-tag' }, ch.type === 'drum' ? 'DRM' : ch.type === 'synth' ? 'SYN' : 'SMP'))

      const mute = h('button', {
        class: `m${ch.mute ? ' on m' : ''}`, title: 'Muet',
        onclick: () => { ch.mute = !ch.mute; mute.classList.toggle('on', ch.mute); mute.classList.toggle('m', ch.mute); c.sync(); c.markDirty() },
      }, 'M')
      const solo = h('button', {
        class: ch.solo ? 'on' : '', title: 'Solo',
        onclick: () => { ch.solo = !ch.solo; c.sync(); c.markDirty(); this.render() },
      }, 'S')
      const roll = h('button', { title: 'Piano roll', onclick: () => this.onOpenRoll(ch.id) }, icon('piano', 12))
      const del = h('button', {
        title: 'Supprimer', onclick: () => this.removeChannel(ch),
      }, '✕')

      const stepEls: HTMLElement[] = []
      const grid = h('div', { class: 'steps' })
      for (let t = 0; t < steps; t++) {
        const s = h('div', {
          class: `step${t % 4 === 0 ? ' beat' : ''}${t % 16 === 0 ? ' bar4' : ''}`,
          style: { '--sc': ch.color },
          dataset: { t: String(t) },
        })
        s.addEventListener('pointerdown', (e) => {
          if (e.button === 2) return
          this.toggleStep(ch, t, s)
        })
        s.addEventListener('contextmenu', (e) => { e.preventDefault(); this.cycleVel(ch, t, s) })
        s.addEventListener('wheel', (e) => {
          e.preventDefault()
          this.nudgeVel(ch, t, s, -Math.sign(e.deltaY) * 0.1)
        }, { passive: false })
        grid.appendChild(s)
        stepEls.push(s)
      }

      const row = h('div', { class: `rack-row${c.selected === ch.id ? ' sel' : ''}` },
        btn, h('div', { class: 'mini' }, mute, solo, roll, del), grid)
      this.scroll.appendChild(row)
      this.rows.set(ch.id, { row, steps: stepEls })
      this.paintRow(ch)
    }

    if (!c.project.channels.length) {
      this.scroll.appendChild(h('div', { class: 'hint', style: { padding: '20px', textAlign: 'center' } },
        'Aucun channel. Ajoute-en un avec le menu « + AJOUTER » en haut.'))
    }
  }

  private renameChannel(ch: Channel) {
    const input = h('input', { class: 'txt', value: ch.name, style: { width: '100%' } })
    this.ctx.dialog({
      title: 'Renommer le channel', icon: 'wrench',
      body: h('div', {}, h('div', { style: { marginBottom: '8px' } }, 'Nouveau petit nom :'), input),
      buttons: [
        { label: 'OK', primary: true, onClick: () => { ch.name = input.value.slice(0, 28) || ch.name; this.ctx.markDirty(); this.ctx.refresh('all') } },
        { label: 'Annuler' },
      ],
    })
    setTimeout(() => { input.focus(); input.select() }, 30)
  }

  private removeChannel(ch: Channel) {
    const c = this.ctx
    if (c.project.channels.length <= 1) { c.toast('Il en faut bien un.'); return }
    c.project.channels = c.project.channels.filter((x) => x.id !== ch.id)
    for (const p of c.project.patterns) p.notes = p.notes.filter((n) => n.ch !== ch.id)
    if (c.selected === ch.id) c.selectChannel(c.project.channels[0].id)
    c.markDirty(); c.sync(); c.refresh('all')
  }

  private noteAt(chId: string, t: number): Note | undefined {
    return this.pattern().notes.find((n) => n.ch === chId && n.t === t)
  }

  private toggleStep(ch: Channel, t: number, el: HTMLElement) {
    const pat = this.pattern()
    const ex = this.noteAt(ch.id, t)
    if (ex) pat.notes = pat.notes.filter((n) => n !== ex)
    else {
      pat.notes.push({ id: uid('n'), ch: ch.id, t, len: ch.type === 'synth' ? 2 : 1, key: 60, vel: 0.85, slice: -1 })
      void this.ctx.engine.preview(ch.id, 60, 2, 0.85)
    }
    this.ctx.markDirty()
    this.paintStep(ch, t, el)
  }

  private cycleVel(ch: Channel, t: number, el: HTMLElement) {
    const n = this.noteAt(ch.id, t)
    if (!n) return
    n.vel = n.vel > 0.8 ? 0.55 : n.vel > 0.45 ? 0.3 : 1
    void this.ctx.engine.preview(ch.id, n.key, n.len, n.vel)
    this.ctx.markDirty()
    this.paintStep(ch, t, el)
  }

  private nudgeVel(ch: Channel, t: number, el: HTMLElement, d: number) {
    const n = this.noteAt(ch.id, t)
    if (!n) return
    n.vel = clamp(n.vel + d, 0.05, 1)
    this.ctx.markDirty()
    this.paintStep(ch, t, el)
  }

  private paintStep(ch: Channel, t: number, el: HTMLElement) {
    const n = this.noteAt(ch.id, t)
    el.classList.toggle('on', !!n)
    el.style.setProperty('--vel', n ? `${Math.round(n.vel * 74)}%` : '0%')
  }

  private paintRow(ch: Channel) {
    const r = this.rows.get(ch.id)
    if (!r) return
    r.steps.forEach((el, t) => this.paintStep(ch, t, el))
  }

  /** Colonne de lecture animee. */
  setPlayhead(step: number) {
    if (step === this.lastCol) return
    for (const { steps } of this.rows.values()) {
      if (this.lastCol >= 0 && steps[this.lastCol]) steps[this.lastCol].classList.remove('play')
      if (step >= 0 && steps[step]) steps[step].classList.add('play')
    }
    this.lastCol = step
  }

  setSelected() {
    for (const [id, r] of this.rows) r.row.classList.toggle('sel', id === this.ctx.selected)
  }
}
