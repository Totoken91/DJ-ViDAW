/* ============================================================
   DJ ViDAW — CHANNEL RACK (le sequenceur pas-a-pas)

   Ergonomie reprise de FL Studio, ou la souris fait tout sans
   passer par un menu :
     · clic gauche       pose un pas — et en restant appuye, on peint
                         toute la trainee, y compris d'une ligne a l'autre
     · clic gauche tenu  sur un pas deja pose : on efface la trainee
     · clic droit tenu   efface tout ce que la souris survole
     · Ctrl + glisser    regle la velocite a la verticale
     · molette           velocite du pas sous le curseur
     · clic droit sur le nom du channel : le menu de l'instrument
   ============================================================ */

import { h, clear } from './dom'
import { icon } from './icons'
import { contextMenu, type MenuItem } from './menu'
import { emptyState } from './shell'
import type { Ctx } from './ctx'
import type { Channel, Note, DrumKind } from '../core/state'
import { uid, patternSteps, makeChannel, clamp, DRUM_KINDS, CH_COLORS, CH_COLOR_NAMES } from '../core/state'

export class Rack {
  el: HTMLElement
  private scroll: HTMLElement
  private rows = new Map<string, { row: HTMLElement; steps: HTMLElement[] }>()
  private lastCol = -1

  /* --- etat du geste en cours sur la grille --- */
  private mode: 'draw' | 'erase' | 'vel' | null = null
  private touched = new Set<string>()   // pas deja traites pendant ce glisser
  private velDrag: { ch: Channel; t: number; el: HTMLElement; base: number; y0: number } | null = null
  private previewed = false
  private moved = false

  constructor(private ctx: Ctx, private onOpenRoll: (chId: string) => void) {
    this.scroll = h('div', { class: 'rack-scroll' })
    this.el = h('div', { class: 'rack' }, this.buildBar(), this.scroll)
    this.bindGrid()
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
      h('div', { class: 'cluster' }, addMenu),
      h('div', { class: 'cluster' },
        h('button', { class: 'btn tiny', dataset: { tip: 'Remplit le motif au hasard, avec des densites plausibles par instrument' }, onclick: () => this.randomize() }, icon('dice'), 'HASARD'),
        h('button', { class: 'btn tiny', dataset: { tip: 'Efface toutes les notes du motif courant' }, onclick: () => this.clearPattern() }, icon('broom'), 'VIDER')),
      h('div', { class: 'spacer' }),
      h('div', { class: 'cluster' },
        h('button', { class: 'btn tiny', dataset: { tip: 'Raccourcit le motif d\'une mesure' }, onclick: () => this.setBars(-1) }, '−'),
        h('span', { class: 'pill', id: 'rack-bars' }, '1 MES'),
        h('button', { class: 'btn tiny', dataset: { tip: 'Rallonge le motif d\'une mesure' }, onclick: () => this.setBars(1) }, '+')),
      h('div', { class: 'cluster' },
        h('button', { class: 'btn tiny', dataset: { tip: 'Ouvre le mixeur (Alt+4)' }, onclick: () => c.openWindow('mixer') }, icon('mixer'), 'MIXEUR')),
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
      const led = h('span', { class: 'ch-led', style: { background: ch.color } })
      const nameEl = h('span', { class: 'ch-name' }, ch.name)
      const btn = h('div', {
        class: 'ch-btn',
        dataset: { tip: `${ch.name} — clic pour selectionner, double-clic pour le piano roll, clic droit pour le menu` },
        onclick: () => c.selectChannel(ch.id),
        ondblclick: () => this.onOpenRoll(ch.id),
        oncontextmenu: (e: Event) => { c.selectChannel(ch.id); this.chanMenu(e as MouseEvent, ch) },
      }, led, nameEl, h('span', { class: 'ch-tag' }, ch.type === 'drum' ? 'DRM' : ch.type === 'synth' ? 'SYN' : 'SMP'))

      const mute = h('button', {
        class: `m${ch.mute ? ' on m' : ''}`, title: 'Muet', dataset: { tip: `Rend ${ch.name} silencieux` },
        onclick: () => {
          ch.mute = !ch.mute
          mute.classList.toggle('on', ch.mute); mute.classList.toggle('m', ch.mute)
          this.rows.get(ch.id)?.row.classList.toggle('muted', ch.mute)
          c.sync(); c.markDirty()
        },
      }, 'M')
      const solo = h('button', {
        class: ch.solo ? 'on' : '', title: 'Solo', dataset: { tip: `N'entend plus que ${ch.name}` },
        onclick: () => { ch.solo = !ch.solo; c.sync(); c.markDirty(); this.render() },
      }, 'S')
      const roll = h('button', { title: 'Piano roll', dataset: { tip: `Ouvre ${ch.name} dans le piano roll` }, onclick: () => this.onOpenRoll(ch.id) }, icon('piano', 12))
      const del = h('button', {
        title: 'Supprimer', onclick: () => this.removeChannel(ch),
      }, '✕')
      del.dataset.tip = `Supprime le channel ${ch.name}`

      const stepEls: HTMLElement[] = []
      // Les pas ne portent aucun ecouteur : le geste est gere une fois pour
      // toutes sur le conteneur (voir bindGrid), ce qui permet de peindre
      // d'une ligne a l'autre sans relacher.
      const grid = h('div', { class: 'steps', dataset: { ch: ch.id } })
      for (let t = 0; t < steps; t++) {
        grid.appendChild(h('div', {
          class: `step${t % 4 === 0 ? ' beat' : ''}${t % 16 === 0 ? ' bar4' : ''}`,
          dataset: { t: String(t) },
        }))
      }
      stepEls.push(...[...grid.children] as HTMLElement[])

      const row = h('div', { class: `rack-row${c.selected === ch.id ? ' sel' : ''}${ch.mute ? ' muted' : ''}` },
        btn, h('div', { class: 'mini' }, mute, solo, roll, del), grid)
      this.scroll.appendChild(row)
      this.rows.set(ch.id, { row, steps: stepEls })
      this.paintRow(ch)
    }

    if (!c.project.channels.length) {
      this.scroll.appendChild(emptyState({
        icon: 'rack',
        title: 'AUCUN INSTRUMENT',
        line: 'Ajoute-en un avec le menu « + AJOUTER » en haut, ou fais un clic droit ici.',
      }))
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

  /* ---------------- le geste sur la grille ---------------- */

  /** Retrouve le pas sous un point ecran. Renvoie null hors grille. */
  private hit(x: number, y: number): { ch: Channel; t: number; el: HTMLElement } | null {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('.step') as HTMLElement | null
    if (!el) return null
    const grid = el.parentElement as HTMLElement | null
    const id = grid?.dataset.ch
    if (!id) return null
    const ch = this.ctx.project.channels.find((c) => c.id === id)
    if (!ch) return null
    return { ch, t: Number(el.dataset.t), el }
  }

  /** Un seul jeu d'ecouteurs pour toute la grille : le glisser peut alors
      traverser les pas ET les lignes sans jamais perdre le fil. */
  private bindGrid() {
    const g = this.scroll

    g.addEventListener('pointerdown', (e) => {
      this.moved = false
      const hit = this.hit(e.clientX, e.clientY)
      if (!hit) return
      const has = !!this.noteAt(hit.ch.id, hit.t)
      this.previewed = false
      this.touched.clear()

      if (e.button === 2) {
        // Clic droit : gomme. On efface aussi tout ce que la souris survole.
        this.mode = 'erase'
      } else if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
        const n = this.noteAt(hit.ch.id, hit.t)
        if (!n) return
        this.mode = 'vel'
        this.velDrag = { ch: hit.ch, t: hit.t, el: hit.el, base: n.vel, y0: e.clientY }
      } else if (e.button === 0) {
        // Le premier pas decide du mode : on pose, ou on efface.
        this.mode = has ? 'erase' : 'draw'
      } else if (e.button === 1) {
        // Clic milieu : le piano roll de l'instrument, comme dans FL.
        e.preventDefault()
        this.onOpenRoll(hit.ch.id)
        return
      } else return

      e.preventDefault()
      g.setPointerCapture(e.pointerId)
      if (this.mode !== 'vel') this.apply(hit)
    })

    g.addEventListener('pointermove', (e) => {
      if (!this.mode) return
      this.moved = true
      if (this.mode === 'vel') {
        const d = this.velDrag
        if (!d) return
        // 120 px de course pour toute l'echelle : assez fin sans etre nerveux
        const v = clamp(d.base + (d.y0 - e.clientY) / 120, 0.05, 1)
        const n = this.noteAt(d.ch.id, d.t)
        if (n && Math.abs(n.vel - v) > 0.001) {
          n.vel = v
          this.ctx.markDirty()
          this.paintStep(d.ch, d.t, d.el)
        }
        return
      }
      const hit = this.hit(e.clientX, e.clientY)
      if (hit) this.apply(hit)
    })

    const end = (e: PointerEvent) => {
      if (!this.mode) return
      this.mode = null
      this.velDrag = null
      this.touched.clear()
      try { g.releasePointerCapture(e.pointerId) } catch { /* deja relache */ }
      this.ctx.sync()
    }
    g.addEventListener('pointerup', end)
    g.addEventListener('pointercancel', end)
    g.addEventListener('lostpointercapture', end)

    // Le menu systeme n'a rien a faire ici : le clic droit est un outil.
    // Le notre s'ouvre au relachement, et seulement si la souris n'a pas
    // bouge — sinon on ouvrirait un menu au beau milieu d'un effacement.
    g.addEventListener('contextmenu', (e) => e.preventDefault())
    g.addEventListener('pointerup', (e) => {
      if (e.button !== 2 || this.moved) return
      // le bouton de channel a deja son propre menu
      if ((e.target as HTMLElement).closest('.ch-btn, .mini')) return
      if (this.hit(e.clientX, e.clientY)) return
      this.rackMenu(e)
    })

    g.addEventListener('wheel', (e) => {
      const hit = this.hit(e.clientX, e.clientY)
      if (!hit || !this.noteAt(hit.ch.id, hit.t)) return
      e.preventDefault()
      this.nudgeVel(hit.ch, hit.t, hit.el, -Math.sign(e.deltaY) * (e.shiftKey ? 0.02 : 0.1))
    }, { passive: false })
  }

  /** Applique le mode courant a un pas, une seule fois par glisser. */
  private apply(hit: { ch: Channel; t: number; el: HTMLElement }) {
    const key = `${hit.ch.id}:${hit.t}`
    if (this.touched.has(key)) return
    this.touched.add(key)
    const pat = this.pattern()
    const ex = this.noteAt(hit.ch.id, hit.t)
    if (this.mode === 'erase') {
      if (!ex) return
      pat.notes = pat.notes.filter((n) => n !== ex)
    } else {
      if (ex) return
      pat.notes.push({
        id: uid('n'), ch: hit.ch.id, t: hit.t,
        len: hit.ch.type === 'synth' ? 2 : 1, key: 60, vel: 0.85, slice: -1,
      })
      // On ne fait entendre que le premier pas du geste : peindre seize
      // cases ne doit pas declencher seize coups de caisse claire.
      if (!this.previewed) { this.previewed = true; void this.ctx.engine.preview(hit.ch.id, 60, 2, 0.85) }
    }
    this.ctx.markDirty()
    this.paintStep(hit.ch, hit.t, hit.el)
  }

  private noteAt(chId: string, t: number): Note | undefined {
    return this.pattern().notes.find((n) => n.ch === chId && n.t === t)
  }

  private nudgeVel(ch: Channel, t: number, el: HTMLElement, d: number) {
    const n = this.noteAt(ch.id, t)
    if (!n) return
    n.vel = clamp(n.vel + d, 0.05, 1)
    this.ctx.markDirty()
    this.paintStep(ch, t, el)
  }

  /* ---------------- menus contextuels ---------------- */

  /** Menu de l'instrument : tout ce qu'on veut faire a une ligne entiere. */
  private chanMenu(ev: MouseEvent, ch: Channel) {
    const c = this.ctx
    const steps = patternSteps(this.pattern())
    const fill = (every: number, from = 0) => {
      const pat = this.pattern()
      pat.notes = pat.notes.filter((n) => n.ch !== ch.id)
      for (let t = from; t < steps; t += every) {
        pat.notes.push({ id: uid('n'), ch: ch.id, t, len: ch.type === 'synth' ? 2 : 1, key: 60, vel: 0.85, slice: -1 })
      }
      c.markDirty(); this.paintRow(ch)
    }
    const shift = (d: number) => {
      const pat = this.pattern()
      for (const n of pat.notes) if (n.ch === ch.id) n.t = (n.t + d + steps) % steps
      c.markDirty(); this.paintRow(ch)
    }

    const items: MenuItem[] = [
      { label: 'Piano roll', ico: 'piano', accel: 'double-clic', onClick: () => this.onOpenRoll(ch.id) },
      { label: 'Reglages de l\'instrument', ico: 'wrench', accel: 'F2', onClick: () => { c.selectChannel(ch.id); c.openWindow('channel') } },
      { label: 'Ecouter', ico: 'play', onClick: () => void c.engine.preview(ch.id, 60, 3, 1) },
      '-',
      { label: 'Renommer...', ico: 'doc', onClick: () => this.renameChannel(ch) },
      { label: 'Couleur', ico: 'star', sub: CH_COLORS.map((col, i) => ({
        label: CH_COLOR_NAMES[i] ?? col,
        swatch: col,
        checked: ch.color === col,
        onClick: () => { ch.color = col; c.markDirty(); c.refresh('all') },
      })) },
      '-',
      { title: 'Le motif de cette ligne' },
      { label: 'Remplir', ico: 'wand', sub: [
        { label: 'Tous les pas', onClick: () => fill(1) },
        { label: 'Un sur deux', onClick: () => fill(2) },
        { label: 'Chaque temps', accel: '1/4', onClick: () => fill(4) },
        { label: 'Contretemps', onClick: () => fill(4, 2) },
        { label: 'Toutes les deux mesures', onClick: () => fill(8) },
      ] },
      { label: 'Decaler', ico: 'loop', sub: [
        { label: 'Vers la gauche', accel: '-1', onClick: () => shift(-1) },
        { label: 'Vers la droite', accel: '+1', onClick: () => shift(1) },
        { label: 'D\'un temps a gauche', onClick: () => shift(-4) },
        { label: 'D\'un temps a droite', onClick: () => shift(4) },
      ] },
      { label: 'Au hasard', ico: 'dice', onClick: () => this.randomizeRow(ch) },
      { label: 'Vider la ligne', ico: 'broom', onClick: () => {
        const pat = this.pattern()
        pat.notes = pat.notes.filter((n) => n.ch !== ch.id)
        c.markDirty(); this.paintRow(ch)
      } },
      '-',
      { label: 'Muet', ico: 'speaker', checked: ch.mute, onClick: () => { ch.mute = !ch.mute; c.sync(); c.markDirty(); this.render() } },
      { label: 'Solo', ico: 'star', checked: ch.solo, onClick: () => { ch.solo = !ch.solo; c.sync(); c.markDirty(); this.render() } },
      { label: 'Dupliquer', ico: 'newdoc', onClick: () => this.cloneChannel(ch) },
      { label: 'Supprimer', ico: 'trash', danger: true, onClick: () => this.removeChannel(ch) },
    ]
    contextMenu(ev, items, { title: ch.name })
  }

  /** Menu du fond du rack : ce qui concerne le motif entier. */
  private rackMenu(ev: MouseEvent) {
    const c = this.ctx
    const add = (v: string, label: string): MenuItem => ({ label, onClick: () => this.addChannel(v) })
    contextMenu(ev, [
      { label: 'Ajouter un instrument', ico: 'plus', sub: [
        { label: 'Percussions', sub: DRUM_KINDS.map((k) => add(`drum:${k}`, k.toUpperCase())) },
        add('synth', 'Synthetiseur'),
        add('sampler', 'Sampler (vide)'),
      ] },
      '-',
      { label: 'Remplir au hasard', ico: 'dice', onClick: () => this.randomize() },
      { label: 'Vider le motif', ico: 'broom', danger: true, onClick: () => this.clearPattern() },
      '-',
      { label: 'Rallonger d\'une mesure', onClick: () => this.setBars(1) },
      { label: 'Raccourcir d\'une mesure', onClick: () => this.setBars(-1) },
      '-',
      { label: 'Ouvrir le mixeur', ico: 'mixer', accel: 'Alt+4', onClick: () => c.openWindow('mixer') },
    ], { title: 'Channel Rack' })
  }

  private cloneChannel(ch: Channel) {
    const c = this.ctx
    const copy: Channel = JSON.parse(JSON.stringify(ch))
    copy.id = uid('ch')
    copy.name = `${ch.name} 2`.slice(0, 28)
    const i = c.project.channels.indexOf(ch)
    c.project.channels.splice(i + 1, 0, copy)
    // le motif suit : dupliquer un instrument sans ses pas ne sert a rien
    const pat = this.pattern()
    for (const n of pat.notes.filter((n) => n.ch === ch.id)) {
      pat.notes.push({ ...n, id: uid('n'), ch: copy.id })
    }
    c.markDirty(); c.sync(); c.refresh('all')
    c.selectChannel(copy.id)
  }

  /** Meme logique que le hasard global, mais sur une seule ligne. */
  private randomizeRow(ch: Channel) {
    const pat = this.pattern()
    const steps = patternSteps(pat)
    pat.notes = pat.notes.filter((n) => n.ch !== ch.id)
    const kind = ch.drum?.kind
    const density = kind === 'kick' ? 0.24 : kind === 'hat' ? 0.55 : kind === 'clap' || kind === 'snare' ? 0.16 : 0.2
    for (let t = 0; t < steps; t++) {
      const chance = density * (t % 4 === 0 ? 2.1 : 0.75)
      if (Math.random() >= chance) continue
      const key = ch.type === 'synth'
        ? 60 + [0, 3, 5, 7, 10][Math.floor(Math.random() * 5)] - (Math.random() < 0.4 ? 12 : 0)
        : 60
      pat.notes.push({ id: uid('n'), ch: ch.id, t, len: ch.type === 'synth' ? 2 : 1, key, vel: 0.5 + Math.random() * 0.5, slice: -1 })
    }
    this.ctx.markDirty()
    this.paintRow(ch)
  }

  private paintStep(ch: Channel, t: number, el: HTMLElement) {
    const n = this.noteAt(ch.id, t)
    el.classList.toggle('on', !!n)
    // --v porte la velocite : elle module la luminosite du pas et la
    // longueur de la reglette du bas, plutot que la teinte
    if (n) {
      el.style.setProperty('--v', n.vel.toFixed(2))
      el.dataset.tip = `${ch.name} · pas ${t + 1} · velocite ${Math.round(n.vel * 127)}`
    } else {
      el.style.removeProperty('--v')
      delete el.dataset.tip
    }
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
