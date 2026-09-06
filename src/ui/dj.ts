/* ============================================================
   DJ ViDAW — MODE DJ VITEAU
   Deux platines, une table, un crossfader. Le plateau se touche :
   on freine avec la paume, on pousse pour recaler, on part en
   arriere. Tout le reste — EQ, filtre, echo, boucles, repères —
   est la ou un DJ le cherche.
   ============================================================ */

import { h, clear } from './dom'
import { icon } from './icons'
import { knob, fader, meter } from './knob'
import { contextMenu, type MenuItem } from './menu'
import type { Ctx } from './ctx'
import { clamp } from '../core/state'
import { computePeaks } from '../audio/samples'
import { DjRig, Deck, RPS, type XfCurve } from '../audio/dj'

const PLATTER = 168

interface DeckUi {
  deck: Deck
  wave: HTMLCanvasElement
  platter: HTMLCanvasElement
  name: HTMLElement
  bpmEl: HTMLElement
  posEl: HTMLElement
  pitchEl: HTMLElement
  playBtn: HTMLElement
  loopBtns: HTMLElement[]
  cueBtns: HTMLElement[]
  meterTick: () => void
  eq: { lo: number; mid: number; hi: number }
  kill: { lo: boolean; mid: boolean; hi: boolean }
  filter: number
  echo: number
  vinyl: number
  angle: number
}

export class DjMode {
  el: HTMLElement
  private body: HTMLElement
  private rig: DjRig | null = null
  private ui: Partial<Record<'A' | 'B', DeckUi>> = {}
  private raf = 0
  private masterMeter: { el: HTMLElement; tick: () => void } | null = null
  private recBtn: HTMLElement | null = null
  private recEl: HTMLElement | null = null
  private fileInput: HTMLInputElement
  private pendingLoad: 'A' | 'B' = 'A'
  private xfEl: HTMLElement | null = null

  constructor(private ctx: Ctx) {
    this.fileInput = h('input', { type: 'file', accept: 'audio/*', style: { display: 'none' } }) as HTMLInputElement
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0]
      if (f) void this.loadFile(this.pendingLoad, f)
      this.fileInput.value = ''
    })
    this.body = h('div', { class: 'dj-scroll' })
    this.el = h('div', { class: 'dj' }, this.bar(), this.body, this.fileInput)
    this.renderIntro()
  }

  /* ---------------- barre ---------------- */

  private bar(): HTMLElement {
    this.recEl = h('span', { class: 'dj-rec-time' }, '')
    this.recBtn = h('button', {
      class: 'dj-btn rec', dataset: { tip: 'Enregistre la sortie de la table : les deux platines, EQ et filtres compris' },
      onclick: () => void this.toggleRec(),
    }, icon('rec', 12), 'ENREGISTRER LE MIX')
    return h('div', { class: 'dj-bar' },
      h('span', { class: 'dj-logo' }, 'DJ VITEAU'),
      h('span', { class: 'dj-sub' }, 'deux platines, une table, aucune pitie'),
      h('div', { class: 'spacer' }),
      this.recEl,
      this.recBtn,
      h('button', { class: 'dj-btn', onclick: () => this.help() }, icon('help', 12), 'AIDE'),
    )
  }

  private help() {
    this.ctx.dialog({
      title: 'Mode DJ Viteau', icon: 'disk',
      body: h('div', { style: { display: 'grid', gap: '7px', maxWidth: '440px' } },
        h('p', { style: { margin: 0 } }, h('b', {}, 'Charger'), ' — glisse un fichier audio sur une platine, ou prends un sample deja importe dans le menu du disque.'),
        h('p', { style: { margin: 0 } }, h('b', {}, 'Le plateau'), ' — au centre, la main tient le disque : on freine, on pousse, on part en arriere. Sur le bord, c\'est un simple coup de pouce pour recaler sans deraper.'),
        h('p', { style: { margin: 0 } }, h('b', {}, 'CUE'), ' — pose le repere a l\'arret, puis maintiens pour ecouter depuis ce point ; en relachant, le disque y revient.'),
        h('p', { style: { margin: 0 } }, h('b', {}, 'SYNC'), ' — cale le tempo ET le temps de cette platine sur l\'autre. Le tempo est detecte a l\'ouverture ; s\'il se trompe, corrige-le au clic droit sur l\'afficheur BPM.'),
        h('p', { style: { margin: 0 } }, h('b', {}, 'Raccourcis'), ' — Q / W : lecture A et B. A / S : cue A et B. Les fleches gauche-droite deplacent le crossfader.'),
        h('p', { style: { margin: 0, color: '#8f86b8' } }, 'Le pitch agit comme sur une platine : la hauteur suit la vitesse. C\'est voulu.'),
      ),
    })
  }

  /* ---------------- accueil ---------------- */

  private renderIntro() {
    clear(this.body)
    this.body.appendChild(h('div', { class: 'dj-intro' },
      h('div', { class: 'dj-intro-art' }, discSvg()),
      h('b', {}, 'DEUX PLATINES T\'ATTENDENT'),
      h('span', {}, 'Glisse un morceau sur une platine, ou choisis un sample deja importe.'),
      h('div', { class: 'dj-intro-row' },
        h('button', { class: 'dj-btn go', onclick: () => void this.boot() }, icon('power', 12), 'ALLUMER LA TABLE'),
      ),
    ))
  }

  /** Le materiel n'existe qu'une fois le son autorise par le navigateur. */
  private async boot() {
    if (this.rig) return
    const actx = await this.ctx.engine.init()
    this.rig = new DjRig(actx, actx.destination)
    this.render()
    this.tick()
  }

  /* ---------------- rendu ---------------- */

  private render() {
    const rig = this.rig
    if (!rig) { this.renderIntro(); return }
    clear(this.body)
    this.ui = {}
    const deckA = this.deckPanel(rig.a)
    const deckB = this.deckPanel(rig.b)
    this.body.append(
      h('div', { class: 'dj-decks' }, deckA, this.mixerPanel(), deckB),
      this.xfadeRow(),
    )
    requestAnimationFrame(() => { this.paintAll(); this.resize() })
  }

  /* ---------------- une platine ---------------- */

  private deckPanel(deck: Deck): HTMLElement {
    const id = deck.id
    const name = h('span', { class: 'dk-name' }, 'AUCUN MORCEAU')
    const bpmEl = h('b', {}, '—')
    const posEl = h('span', { class: 'dk-time' }, '0:00 / 0:00')
    const pitchEl = h('span', { class: 'dk-pitch' }, '0.0 %')

    const wave = h('canvas', { class: 'dk-wave-cv' }) as HTMLCanvasElement
    const waveBox = h('div', { class: 'dk-wave' }, wave)
    const platter = h('canvas', { class: 'dk-platter-cv', width: String(PLATTER * 2), height: String(PLATTER * 2) }) as HTMLCanvasElement
    platter.style.width = `${PLATTER}px`
    platter.style.height = `${PLATTER}px`

    const playBtn = h('button', {
      class: 'dk-play', dataset: { tip: `Lecture / pause platine ${id}` },
      onclick: () => { deck.toggle(); this.paintDeck(id) },
    }, icon('play', 14), 'PLAY')

    const cueBtn = h('button', { class: 'dk-cue', dataset: { tip: 'Maintiens pour ecouter depuis le repere · relache pour y revenir' } }, 'CUE')
    cueBtn.addEventListener('pointerdown', (e) => {
      cueBtn.setPointerCapture(e.pointerId)
      if (!deck.playing && Math.abs(deck.position - deck.cue) < 0.02) deck.setCueHere()
      deck.cuePress(); this.paintDeck(id)
    })
    const cueUp = () => { deck.cueRelease(); this.paintDeck(id) }
    cueBtn.addEventListener('pointerup', cueUp)
    cueBtn.addEventListener('pointercancel', cueUp)

    /* --- fader de pitch --- */
    const pitchFader = fader({
      min: -0.16, max: 0.16, value: 0, def: 0, height: 128, label: `PITCH ${id}`,
      color: '#5fe6ff',
      onInput: (v) => { deck.setPitch(v); this.paintDeck(id) },
    })
    const pitchRange = h('button', { class: 'dk-mini', dataset: { tip: 'Plage du fader de pitch' } }, '±16%')
    const setRange = (r: number) => {
      const f = pitchFader as HTMLElement & { setRange?: (m: number) => void }
      f.setRange?.(r / 100)
      pitchRange.textContent = `±${r}%`
    }
    pitchRange.addEventListener('click', (e) => {
      contextMenu(e, [8, 16, 25, 50].map((r) => ({
        label: `± ${r} %`, onClick: () => setRange(r),
      })), { title: 'Plage de pitch' })
    })
    /** Le SYNC peut demander plus que la plage courante : on l'elargit
        plutot que de mentir sur la position du fader. */
    const fitRange = (p: number) => {
      const need = Math.abs(p) * 100
      for (const r of [8, 16, 25, 50]) if (need <= r + 0.01) { setRange(r); return }
      setRange(50)
    }

    const syncBtn = h('button', {
      class: 'dk-mini go', dataset: { tip: `Cale la platine ${id} sur l'autre : tempo puis temps` },
      onclick: () => {
        if (!this.rig?.sync(id)) { this.ctx.toast('Il faut un morceau sur les deux platines.'); return }
        fitRange(deck.pitch)
        const f = pitchFader as HTMLElement & { setValue?: (v: number) => void }
        f.setValue?.(deck.pitch)
        this.paintDeck(id)
        this.ctx.toast(`Platine ${id} calee sur ${(id === 'A' ? this.rig!.b : this.rig!.a).bpm.toFixed(1)} BPM`)
      },
    }, 'SYNC')

    /* --- repères et boucles --- */
    const cueBtns = [0, 1, 2, 3].map((i) => {
      const b = h('button', {
        class: 'dk-hot', dataset: { tip: `Repere ${i + 1} — clic pour poser puis sauter, clic droit pour l'effacer` },
        onclick: () => { deck.hotCue(i); this.paintDeck(id) },
        oncontextmenu: (e: Event) => {
          e.preventDefault(); deck.clearHotCue(i); this.paintDeck(id)
        },
      }, String(i + 1))
      return b
    })

    const loopBtns = [1, 2, 4, 8].map((n) => h('button', {
      class: 'dk-loop', dataset: { tip: `Boucle de ${n} temps a partir d'ici` },
      onclick: () => {
        if (deck.loopLength === n) deck.clearLoop()
        else deck.setLoopBeats(n)
        this.paintDeck(id)
      },
    }, String(n)))

    /* --- effets de jeu : ils se tiennent, ils ne se cliquent pas --- */
    const hold = (label: string, tip: string, down: () => void, up: () => void) => {
      const b = h('button', { class: 'dk-fx', dataset: { tip } }, label)
      b.addEventListener('pointerdown', (e) => {
        b.setPointerCapture(e.pointerId); b.classList.add('on'); down(); this.paintDeck(id)
      })
      const end = () => { if (!b.classList.contains('on')) return; b.classList.remove('on'); up(); this.paintDeck(id) }
      b.addEventListener('pointerup', end)
      b.addEventListener('pointercancel', end)
      b.addEventListener('lostpointercapture', end)
      return b
    }
    const playRow = [
      hold('FREIN', 'Coupe le moteur : le disque ralentit puis s\'arrete. En relachant, il repart.',
        () => deck.brake(true), () => { deck.play(); deck.brake(false) }),
      hold('ENVERS', 'Lit a l\'envers tant que c\'est tenu',
        () => deck.setReverse(true), () => deck.setReverse(false)),
      hold('1/4', 'Roulement d\'un temps', () => deck.rollStart(1), () => deck.rollEnd()),
      hold('1/8', 'Roulement d\'un demi-temps', () => deck.rollStart(0.5), () => deck.rollEnd()),
      hold('1/16', 'Roulement d\'un quart de temps', () => deck.rollStart(0.25), () => deck.rollEnd()),
    ]

    const loadBtn = h('button', {
      class: 'dk-mini', dataset: { tip: 'Charge un morceau sur cette platine' },
      onclick: (e: Event) => this.loadMenu(e as MouseEvent, id),
    }, icon('folder', 11), 'CHARGER')

    const panel = h('div', { class: `dj-deck deck-${id}` },
      h('div', { class: 'dk-head' },
        h('span', { class: 'dk-id' }, id),
        name,
        h('div', { class: 'spacer' }),
        loadBtn,
      ),
      waveBox,
      h('div', { class: 'dk-main' },
        h('div', { class: 'dk-platter' }, platter),
        h('div', { class: 'dk-side' },
          h('div', { class: 'dk-bpm' }, h('u', {}, 'BPM'), bpmEl, pitchEl),
          pitchFader,
          h('div', { class: 'dk-row' }, pitchRange, syncBtn),
        ),
      ),
      h('div', { class: 'dk-transport' }, cueBtn, playBtn, posEl),
      h('div', { class: 'dk-pads' },
        h('div', { class: 'dk-padrow' }, h('u', {}, 'REPERES'), ...cueBtns),
        h('div', { class: 'dk-padrow' }, h('u', {}, 'BOUCLE'), ...loopBtns,
          h('button', { class: 'dk-loop out', dataset: { tip: 'Sort de la boucle' }, onclick: () => { deck.clearLoop(); this.paintDeck(id) } }, '✕')),
        h('div', { class: 'dk-padrow' }, h('u', {}, 'JEU'), ...playRow),
      ),
    )

    const ui: DeckUi = {
      deck, wave, platter, name, bpmEl, posEl, pitchEl, playBtn, loopBtns, cueBtns,
      meterTick: () => {},
      eq: { lo: 0, mid: 0, hi: 0 },
      kill: { lo: false, mid: false, hi: false },
      filter: 0, echo: 0, vinyl: 0, angle: 0,
    }
    this.ui[id] = ui

    this.bindPlatter(ui)
    this.bindWave(ui)
    this.bindDrop(panel, id)
    deck.onLoad = () => this.paintDeck(id)
    return panel
  }

  /* ---------------- la table ---------------- */

  private mixerPanel(): HTMLElement {
    const strip = (id: 'A' | 'B') => {
      const ui = () => this.ui[id]!
      const push = () => { const u = ui(); u.deck.setEq(u.eq, u.kill) }
      const kill = (which: 'lo' | 'mid' | 'hi', label: string) => {
        const b = h('button', {
          class: 'mx-kill', dataset: { tip: `Coupe completement ${label} sur la platine ${id}` },
          onclick: () => { const u = ui(); u.kill[which] = !u.kill[which]; b.classList.toggle('on', u.kill[which]); push() },
        }, '⨯')
        return b
      }
      const K = (label: string, get: () => number, set: (v: number) => void, color: string) =>
        knob({
          min: -26, max: 8, value: get(), def: 0, label, size: 34, color,
          format: (v) => (v <= -25.5 ? 'KILL' : `${v > 0 ? '+' : ''}${v.toFixed(0)}`),
          onInput: (v) => { set(v); push() },
        })

      const m = meter(null, 9, 118)
      const vol = fader({
        min: 0, max: 1, value: 0.85, def: 0.85, height: 118, label: `VOLUME ${id}`,
        color: id === 'A' ? '#ff5cb0' : '#5fe6ff',
        onInput: (v) => ui().deck.setVolume(v),
      })

      const el = h('div', { class: `mx-strip mx-${id}` },
        h('u', {}, id),
        knob({
          min: 0, max: 2, value: 1, def: 1, label: 'TRIM', size: 30, color: '#c9b6ff',
          format: (v) => `${Math.round(v * 100)}`,
          onInput: (v) => ui().deck.setTrim(v),
        }),
        h('div', { class: 'mx-eq' },
          h('div', { class: 'mx-eqrow' }, K('AIGU', () => ui().eq.hi, (v) => { ui().eq.hi = v }, '#5fe6ff'), kill('hi', 'les aigus')),
          h('div', { class: 'mx-eqrow' }, K('MEDIUM', () => ui().eq.mid, (v) => { ui().eq.mid = v }, '#b48cff'), kill('mid', 'le medium')),
          h('div', { class: 'mx-eqrow' }, K('GRAVE', () => ui().eq.lo, (v) => { ui().eq.lo = v }, '#ff5cb0'), kill('lo', 'les graves')),
        ),
        knob({
          min: -1, max: 1, value: 0, def: 0, label: 'FILTRE', size: 38, color: '#ffa54d', ticks: 9,
          format: (v) => (Math.abs(v) < 0.03 ? 'off' : v < 0 ? `LP ${Math.round(-v * 100)}` : `HP ${Math.round(v * 100)}`),
          onInput: (v) => { ui().filter = v; ui().deck.setFilter(v) },
        }),
        knob({
          min: 0, max: 1, value: 0, def: 0, label: 'ECHO', size: 32, color: '#8ee06a',
          format: (v) => (v < 0.02 ? 'off' : `${Math.round(v * 100)}%`),
          onInput: (v) => { ui().echo = v; ui().deck.setEcho(v) },
        }),
        h('div', { class: 'mx-fader' }, vol, m.el),
      )
      // le vu-metre a besoin de l'analyseur de la platine, cree avec la table
      requestAnimationFrame(() => {
        const u = this.ui[id]
        if (u) u.meterTick = mkMeter(m, u.deck)
      })
      return el
    }

    const masterM = meter(null, 11, 92)
    this.masterMeter = { el: masterM.el, tick: () => {} }
    requestAnimationFrame(() => {
      if (this.rig) this.masterMeter = { el: masterM.el, tick: mkMeterFrom(masterM, this.rig.analyser) }
    })

    const master = h('div', { class: 'mx-master' },
      h('u', {}, 'MASTER'),
      masterM.el,
      knob({
        min: 0, max: 1.4, value: 0.9, def: 0.9, label: 'SORTIE', size: 40, color: '#ffd489', ticks: 9,
        format: (v) => `${Math.round(v * 100)}`,
        onInput: (v) => this.rig?.setMaster(v),
      }),
      h('button', {
        class: 'dk-mini', dataset: { tip: 'Craquements de vinyle sur les deux platines' },
        onclick: (e: Event) => {
          const b = e.currentTarget as HTMLElement
          const on = !b.classList.contains('on')
          b.classList.toggle('on', on)
          for (const id of ['A', 'B'] as const) this.ui[id]?.deck.setVinyl(on ? 0.35 : 0)
        },
      }, 'VINYLE'),
    )

    return h('div', { class: 'dj-mixer' }, strip('A'), master, strip('B'))
  }

  private xfadeRow(): HTMLElement {
    const track = h('div', { class: 'xf-track' })
    const cap = h('div', { class: 'xf-cap' })
    track.appendChild(cap)
    this.xfEl = cap

    const set = (x: number) => {
      this.rig?.setXfade(clamp(x, 0, 1))
      cap.style.left = `${clamp(x, 0, 1) * 100}%`
    }
    let down = false
    const from = (e: PointerEvent) => {
      const r = track.getBoundingClientRect()
      set((e.clientX - r.left) / Math.max(1, r.width))
    }
    track.addEventListener('pointerdown', (e) => {
      down = true; track.setPointerCapture(e.pointerId); from(e); e.preventDefault()
    })
    track.addEventListener('pointermove', (e) => { if (down) from(e) })
    const up = () => { down = false }
    track.addEventListener('pointerup', up)
    track.addEventListener('pointercancel', up)
    track.addEventListener('dblclick', () => set(0.5))

    const curveSel = h('select', { class: 'sel', onchange: (e: Event) => {
      const v = (e.target as HTMLSelectElement).value as XfCurve
      this.rig?.setXfade(this.rig.xfade, v)
    } },
      h('option', { value: 'douce' }, 'COURBE DOUCE'),
      h('option', { value: 'lineaire' }, 'LINEAIRE'),
      h('option', { value: 'coupe' }, 'COUPE NETTE'),
    )

    set(0.5)
    return h('div', { class: 'dj-xf' },
      h('span', { class: 'xf-side' }, 'A'),
      track,
      h('span', { class: 'xf-side' }, 'B'),
      curveSel,
      h('span', { class: 'dj-sub' }, 'double-clic pour recentrer · fleches gauche/droite'),
    )
  }

  /* ---------------- chargement ---------------- */

  private loadMenu(ev: MouseEvent, id: 'A' | 'B') {
    const items: MenuItem[] = [
      { label: 'Ouvrir un fichier...', ico: 'folder', onClick: () => { this.pendingLoad = id; this.fileInput.click() } },
    ]
    const list = this.ctx.samples.list()
    if (list.length) {
      items.push('-', { title: 'Samples du projet' })
      for (const s of list) {
        items.push({
          label: s.name, ico: 'wave',
          onClick: () => this.adopt(id, s.buffer, s.name, s.peaks),
        })
      }
    }
    items.push('-', {
      label: 'Le morceau du projet', ico: 'rack',
      onClick: () => void this.loadProject(id),
    })
    contextMenu(ev, items, { title: `Platine ${id}` })
  }

  private bindDrop(panel: HTMLElement, id: 'A' | 'B') {
    panel.addEventListener('dragover', (e) => { e.preventDefault(); panel.classList.add('drop') })
    panel.addEventListener('dragleave', () => panel.classList.remove('drop'))
    panel.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation()
      panel.classList.remove('drop')
      const f = e.dataTransfer?.files?.[0]
      if (f) void this.loadFile(id, f)
    })
  }

  private async loadFile(id: 'A' | 'B', file: File) {
    try {
      await this.boot()
      const actx = this.ctx.engine.ctx!
      const raw = await file.arrayBuffer()
      const buf = await actx.decodeAudioData(raw)
      this.adopt(id, buf, file.name.replace(/\.[^.]+$/, ''))
    } catch {
      this.ctx.toast('Ce fichier ne veut pas se decoder.')
    }
  }

  private async loadProject(id: 'A' | 'B') {
    await this.boot()
    this.ctx.toast('Rendu du projet en cours...')
    const { renderProject } = await import('../audio/render')
    const buf = await renderProject(this.ctx.project, this.ctx.samples, { mode: 'song', tail: 1.5, repeats: 1 })
    this.adopt(id, buf, this.ctx.project.name || 'PROJET')
  }

  private adopt(id: 'A' | 'B', buf: AudioBuffer, name: string, peaks?: Float32Array) {
    const ui = this.ui[id]
    if (!ui) return
    ui.deck.load(buf, name.slice(0, 34), peaks ?? computePeaks(buf, 1600))
    if (!ui.deck.peaks) ui.deck.peaks = computePeaks(buf, 1600)
    this.paintDeck(id)
    this.ctx.toast(`${name} sur la platine ${id} — ${ui.deck.beat.bpm.toFixed(1)} BPM`)
  }

  /* ---------------- le plateau ---------------- */

  private bindPlatter(ui: DeckUi) {
    const cv = ui.platter
    let grabbing = false
    let nudging = 0
    let lastAngle = 0
    let lastT = 0
    let vel = 0

    const angleOf = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2))
    }
    const radiusOf = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2)
      return Math.hypot(dx, dy) / (r.width / 2)
    }

    cv.addEventListener('pointerdown', (e) => {
      if (!ui.deck.buffer) return
      cv.setPointerCapture(e.pointerId)
      lastAngle = angleOf(e)
      lastT = performance.now()
      vel = 0
      // Le bord du disque ne sert qu'a pousser : c'est ce qu'on fait pour
      // recaler deux morceaux sans les arreter.
      if (radiusOf(e) > 0.82) { nudging = 1; cv.classList.add('nudge'); return }
      grabbing = true
      cv.classList.add('grab')
      ui.deck.touch()
      e.preventDefault()
    })

    cv.addEventListener('pointermove', (e) => {
      if (!grabbing && !nudging) return
      const a = angleOf(e)
      const now = performance.now()
      let da = a - lastAngle
      while (da > Math.PI) da -= Math.PI * 2
      while (da < -Math.PI) da += Math.PI * 2
      const dt = Math.max(0.006, (now - lastT) / 1000)
      lastAngle = a; lastT = now
      const rps = da / (Math.PI * 2) / dt
      // lissage : la souris arrive par a-coups, le disque ne saute pas
      vel = vel * 0.55 + rps * 0.45
      if (grabbing) ui.deck.scrub(vel)
      else ui.deck.nudge(Math.sign(vel), Math.abs(vel) > 0.05)
    })

    const up = (e: PointerEvent) => {
      if (grabbing) { ui.deck.release(); grabbing = false; cv.classList.remove('grab') }
      if (nudging) { ui.deck.nudge(0, false); nudging = 0; cv.classList.remove('nudge') }
      try { cv.releasePointerCapture(e.pointerId) } catch { /* deja relache */ }
      this.paintDeck(ui.deck.id)
    }
    cv.addEventListener('pointerup', up)
    cv.addEventListener('pointercancel', up)

    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const d = ui.deck
      contextMenu(e, [
        { label: 'Charger un morceau', ico: 'folder', onClick: () => this.loadMenu(e, d.id) },
        { label: 'Poser le repere ici', ico: 'star', onClick: () => { d.setCueHere(); this.paintDeck(d.id) } },
        { label: 'Revenir au debut', ico: 'loop', onClick: () => { d.seek(0); this.paintDeck(d.id) } },
        '-',
        { label: `Tempo detecte : ${d.beat.bpm.toFixed(1)}`, disabled: true },
        { label: 'Corriger le tempo', ico: 'clock', sub: [
          { label: 'Doubler (×2)', onClick: () => { d.beat.bpm *= 2; this.paintDeck(d.id) } },
          { label: 'Moitie (÷2)', onClick: () => { d.beat.bpm /= 2; this.paintDeck(d.id) } },
          { label: 'Re-analyser', onClick: () => { if (d.buffer) { d.load(d.buffer, d.name, d.peaks ?? undefined); this.paintDeck(d.id) } } },
        ] },
        '-',
        { label: 'Vider la platine', ico: 'trash', danger: true, onClick: () => {
          d.pause(); d.buffer = null; d.peaks = null; d.name = ''
          this.paintDeck(d.id)
        } },
      ], { title: `Platine ${d.id}` })
    })
  }

  /* ---------------- la forme d'onde ---------------- */

  private bindWave(ui: DeckUi) {
    const cv = ui.wave
    cv.addEventListener('pointerdown', (e) => {
      const d = ui.deck
      if (!d.buffer) return
      const r = cv.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width
      // moitie haute : vue d'ensemble, on saute. moitie basse : vue zoomee.
      if ((e.clientY - r.top) / r.height < 0.44) d.seek(x * d.duration)
      else d.seek(d.position + (x - 0.5) * 8)
      this.paintDeck(d.id)
    })
    cv.addEventListener('contextmenu', (e) => { e.preventDefault(); ui.deck.setCueHere(); this.paintDeck(ui.deck.id) })
  }

  /* ---------------- enregistrement ---------------- */

  private async toggleRec() {
    await this.boot()
    const rig = this.rig
    if (!rig) return
    if (rig.recording) {
      const buf = rig.stopRec()
      this.recBtn?.classList.remove('on')
      if (this.recEl) this.recEl.textContent = ''
      if (!buf) { this.ctx.toast('Rien n\'a ete capture.'); return }
      this.ctx.offerRender(buf, 'dj_viteau_mix', 'Ton mix')
      return
    }
    if (!rig.startRec()) { this.ctx.toast('Enregistrement indisponible sur ce navigateur.'); return }
    this.recBtn?.classList.add('on')
    this.ctx.toast('Ca tourne. Refais ENREGISTRER pour arreter.')
  }

  /* ---------------- peinture ---------------- */

  private paintAll() { for (const id of ['A', 'B'] as const) this.paintDeck(id) }

  private paintDeck(id: 'A' | 'B') {
    const ui = this.ui[id]
    if (!ui) return
    const d = ui.deck
    ui.name.textContent = d.name || 'AUCUN MORCEAU'
    ui.name.classList.toggle('empty', !d.buffer)
    ui.bpmEl.textContent = d.buffer ? d.bpm.toFixed(1) : '—'
    ui.pitchEl.textContent = `${d.pitch >= 0 ? '+' : ''}${(d.pitch * 100).toFixed(1)} %`
    ui.posEl.textContent = `${fmtTime(d.position)} / ${fmtTime(d.duration)}`
    ui.playBtn.classList.toggle('on', d.playing)
    ui.loopBtns.forEach((b, i) => b.classList.toggle('on', d.loopLength === [1, 2, 4, 8][i]))
    ui.cueBtns.forEach((b, i) => b.classList.toggle('set', d.hotCues[i] !== null))
    this.paintWave(ui)
    this.paintPlatter(ui)
  }

  private paintWave(ui: DeckUi) {
    const cv = ui.wave, d = ui.deck
    const w = cv.clientWidth, hh = cv.clientHeight
    if (w < 8 || hh < 8) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr) }
    const g = cv.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, hh)
    g.fillStyle = '#0a0814'
    g.fillRect(0, 0, w, hh)

    const col = d.id === 'A' ? '#ff5cb0' : '#5fe6ff'
    const topH = Math.round(hh * 0.42)
    const zoomY = topH + 1
    const zoomH = hh - zoomY

    if (!d.buffer || !d.peaks) {
      g.fillStyle = 'rgba(150,140,190,.45)'
      g.font = '10px Tahoma, "DejaVu Sans", sans-serif'
      g.textAlign = 'center'
      g.fillText('depose un morceau ici', w / 2, hh / 2 + 3)
      g.textAlign = 'left'
      return
    }

    /* --- vue d'ensemble --- */
    const peaks = d.peaks
    const cols = peaks.length / 2
    g.fillStyle = col
    g.globalAlpha = 0.55
    for (let x = 0; x < w; x++) {
      const i = Math.min(cols - 1, Math.floor((x / w) * cols))
      const mn = peaks[i * 2], mx = peaks[i * 2 + 1]
      const y0 = topH / 2 - mx * (topH / 2 - 1)
      const y1 = topH / 2 - mn * (topH / 2 - 1)
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0))
    }
    g.globalAlpha = 1
    // boucle
    if (d.loop) {
      const xa = (d.loop.a / d.duration) * w, xb = (d.loop.b / d.duration) * w
      g.fillStyle = 'rgba(255,210,80,.22)'
      g.fillRect(xa, 0, Math.max(2, xb - xa), topH)
    }
    // repères
    d.hotCues.forEach((c, i) => {
      if (c === null) return
      const x = (c / d.duration) * w
      g.fillStyle = '#ffd489'
      g.fillRect(x, 0, 1, topH)
      g.font = '700 8px Tahoma, "DejaVu Sans", sans-serif'
      g.fillText(String(i + 1), x + 2, 9)
    })
    g.fillStyle = 'rgba(255,255,255,.5)'
    g.fillRect((d.cue / d.duration) * w, 0, 1, topH)
    const px = (d.position / d.duration) * w
    g.fillStyle = '#fff'
    g.fillRect(px - 1, 0, 2, topH)

    /* --- vue zoomee, 8 secondes centrees sur la tete --- */
    g.fillStyle = '#07050f'
    g.fillRect(0, zoomY, w, zoomH)
    const span = 8
    const t0 = d.position - span / 2, t1 = d.position + span / 2
    const per = 60 / Math.max(20, d.beat.bpm)
    // grille de temps
    let n = Math.floor((t0 - d.beat.offset) / per)
    for (let t = d.beat.offset + n * per; t < t1; t += per, n++) {
      const x = ((t - t0) / span) * w
      const bar = ((n % 4) + 4) % 4 === 0
      g.fillStyle = bar ? 'rgba(255,255,255,.30)' : 'rgba(255,255,255,.11)'
      g.fillRect(x, zoomY, bar ? 2 : 1, zoomH)
    }
    // onde
    const ch = d.buffer.getChannelData(0)
    const rate = d.buffer.sampleRate
    g.fillStyle = col
    for (let x = 0; x < w; x++) {
      const ta = t0 + (x / w) * span
      const s0 = Math.floor(ta * rate)
      const s1 = Math.floor((ta + span / w) * rate)
      if (s1 <= 0 || s0 >= ch.length) continue
      let mn = 0, mx = 0
      for (let i = Math.max(0, s0); i < Math.min(ch.length, s1); i += 2) {
        const v = ch[i]
        if (v < mn) mn = v
        if (v > mx) mx = v
      }
      const mid = zoomY + zoomH / 2
      const y0 = mid - mx * (zoomH / 2 - 1)
      const y1 = mid - mn * (zoomH / 2 - 1)
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0))
    }
    if (d.loop) {
      const xa = ((d.loop.a - t0) / span) * w, xb = ((d.loop.b - t0) / span) * w
      g.fillStyle = 'rgba(255,210,80,.18)'
      g.fillRect(xa, zoomY, Math.max(2, xb - xa), zoomH)
    }
    g.fillStyle = '#fff'
    g.fillRect(w / 2 - 1, zoomY, 2, zoomH)
  }

  private paintPlatter(ui: DeckUi) {
    const cv = ui.platter, d = ui.deck
    const g = cv.getContext('2d')!
    const S = cv.width
    const c = S / 2
    g.clearRect(0, 0, S, S)

    const col = d.id === 'A' ? '#ff5cb0' : '#5fe6ff'
    const ang = ui.angle

    /* --- socle --- */
    g.beginPath(); g.arc(c, c, c - 3, 0, Math.PI * 2)
    const base = g.createLinearGradient(0, 0, 0, S)
    base.addColorStop(0, '#3a3550'); base.addColorStop(1, '#151221')
    g.fillStyle = base; g.fill()
    g.lineWidth = 3; g.strokeStyle = '#0a0814'; g.stroke()

    /* --- le disque : des sillons, pas un aplat --- */
    g.save()
    g.translate(c, c); g.rotate(ang); g.translate(-c, -c)
    g.beginPath(); g.arc(c, c, c - 10, 0, Math.PI * 2)
    const vin = g.createRadialGradient(c, c, c * 0.2, c, c, c)
    vin.addColorStop(0, '#232030'); vin.addColorStop(0.7, '#12101c'); vin.addColorStop(1, '#0a0812')
    g.fillStyle = vin; g.fill()
    for (let r = c * 0.34; r < c - 12; r += 3.5) {
      g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2)
      g.strokeStyle = `rgba(255,255,255,${r % 7 < 3.5 ? 0.045 : 0.02})`
      g.lineWidth = 1; g.stroke()
    }
    // reflet fixe par rapport au disque : c'est lui qui rend la rotation lisible
    g.beginPath()
    g.ellipse(c - c * 0.3, c - c * 0.34, c * 0.5, c * 0.14, -0.7, 0, Math.PI * 2)
    g.fillStyle = 'rgba(255,255,255,.05)'; g.fill()

    // etiquette
    g.beginPath(); g.arc(c, c, c * 0.33, 0, Math.PI * 2)
    const lab = g.createLinearGradient(0, c - c * 0.33, 0, c + c * 0.33)
    lab.addColorStop(0, col); lab.addColorStop(1, shade(col, -0.45))
    g.fillStyle = lab; g.fill()
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 2; g.stroke()
    g.fillStyle = 'rgba(0,0,0,.75)'
    g.font = `700 ${Math.round(S * 0.13)}px Trebuchet MS, Tahoma, sans-serif`
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(d.id, c, c - S * 0.03)
    g.font = `${Math.round(S * 0.045)}px Tahoma, "DejaVu Sans", sans-serif`
    g.fillText((d.name || 'VIDE').slice(0, 14).toUpperCase(), c, c + S * 0.06)
    // repere de rotation
    g.fillStyle = 'rgba(255,255,255,.85)'
    g.fillRect(c - 1.5, c - c * 0.33 - 14, 3, 12)
    g.restore()

    /* --- axe --- */
    g.beginPath(); g.arc(c, c, S * 0.018, 0, Math.PI * 2)
    g.fillStyle = '#e8e2f5'; g.fill()

    /* --- anneau de progression --- */
    const p = d.duration > 0 ? d.position / d.duration : 0
    g.beginPath(); g.arc(c, c, c - 6, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2)
    g.strokeStyle = col; g.lineWidth = 4
    g.shadowColor = col; g.shadowBlur = 8
    g.stroke(); g.shadowBlur = 0

    /* --- etat --- */
    if (d.scratching) {
      g.beginPath(); g.arc(c, c, c - 6, 0, Math.PI * 2)
      g.strokeStyle = 'rgba(255,255,255,.65)'; g.lineWidth = 2; g.stroke()
    }
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'
  }

  /* ---------------- boucle d'animation ---------------- */

  private tick = () => {
    this.raf = requestAnimationFrame(this.tick)
    if (!this.rig || !this.el.isConnected || !this.el.offsetParent) return
    for (const id of ['A', 'B'] as const) {
      const ui = this.ui[id]
      if (!ui) continue
      const d = ui.deck
      // l'angle du plateau suit la position : on voit la vitesse reelle,
      // scratch compris
      ui.angle = d.position * RPS * Math.PI * 2
      ui.posEl.textContent = `${fmtTime(d.position)} / ${fmtTime(d.duration)}`
      ui.playBtn.classList.toggle('on', d.playing)
      this.paintPlatter(ui)
      if (d.buffer) this.paintWave(ui)
      ui.meterTick()
    }
    this.masterMeter?.tick()
    if (this.rig.recording && this.recEl) this.recEl.textContent = `● ${fmtTime(this.rig.recorded)}`
  }

  /* ---------------- cycle de vie ---------------- */

  refresh() { if (this.rig) this.paintAll() }
  resize() { if (this.rig) for (const id of ['A', 'B'] as const) { const u = this.ui[id]; if (u) this.paintWave(u) } }

  /** Raccourcis clavier, actifs seulement quand la fenetre est visible. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.rig || !this.el.isConnected || !this.el.offsetParent) return false
    const k = e.key.toLowerCase()
    const map: Record<string, () => void> = {
      q: () => { this.rig!.a.toggle(); this.paintDeck('A') },
      w: () => { this.rig!.b.toggle(); this.paintDeck('B') },
      z: () => { this.rig!.b.toggle(); this.paintDeck('B') },   // AZERTY
      a: () => { this.rig!.a.cuePress(); this.paintDeck('A') },
      s: () => { this.rig!.b.cuePress(); this.paintDeck('B') },
      arrowleft: () => this.moveXfade(-0.06),
      arrowright: () => this.moveXfade(0.06),
    }
    const fn = map[k]
    if (!fn) return false
    fn()
    return true
  }

  private moveXfade(d: number) {
    if (!this.rig) return
    const x = clamp(this.rig.xfade + d, 0, 1)
    this.rig.setXfade(x)
    if (this.xfEl) this.xfEl.style.left = `${x * 100}%`
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.rig?.dispose()
    this.rig = null
  }
}

/* ------------------------------------------------------------------ */

function mkMeter(m: { el: HTMLElement; tick: () => void }, deck: Deck) {
  return mkMeterFrom(m, deck.analyser)
}

/** Le composant meter() fige son analyseur a la construction ; ici il
    n'existe qu'apres. On re-cable donc a la main. */
function mkMeterFrom(m: { el: HTMLElement; tick: () => void }, an: AnalyserNode | null) {
  if (!an) return () => {}
  const cv = m.el as HTMLCanvasElement
  const g = cv.getContext('2d')!
  const data = new Uint8Array(an.fftSize)
  let peak = 0
  return () => {
    an.getByteTimeDomainData(data as Uint8Array<ArrayBuffer>)
    let rms = 0
    for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; rms += v * v }
    rms = Math.sqrt(rms / data.length)
    const lvl = Math.min(1, Math.pow(rms * 2.4, 0.65))
    peak = Math.max(lvl, peak - 0.012)
    const W = cv.width, H = cv.height
    g.clearRect(0, 0, W, H)
    g.fillStyle = '#0a0d10'; g.fillRect(0, 0, W, H)
    const segs = 24
    for (let i = 0; i < segs; i++) {
      const n = i / segs
      g.fillStyle = n > lvl ? 'rgba(255,255,255,.05)'
        : n > 0.86 ? '#d94f4f' : n > 0.66 ? '#e0bb3c' : '#4bbf5f'
      g.fillRect(1, H - (i + 1) * (H / segs) + 2, W - 2, H / segs - 3)
    }
    if (peak > 0.02) {
      g.fillStyle = peak > 0.94 ? '#ff2e4d' : '#fff'
      g.fillRect(0, H - peak * H - 2, W, 3)
    }
  }
}

function fmtTime(s: number) {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

function shade(hex: string, amt: number): string {
  const m = hex.replace('#', '')
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16)
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 + amt))))
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`
}

/** Le disque de l'ecran d'accueil. */
function discSvg(): HTMLElement {
  const wrap = document.createElement('span')
  wrap.className = 'icw'
  wrap.innerHTML = `<svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
    <defs><radialGradient id="dv" cx="38%" cy="34%">
      <stop offset="0" stop-color="#3a3550"/><stop offset="70%" stop-color="#141020"/><stop offset="100%" stop-color="#0a0812"/>
    </radialGradient></defs>
    <circle cx="32" cy="32" r="30" fill="url(#dv)" stroke="#0a0814" stroke-width="2"/>
    ${[26, 22, 18, 14].map((r) => `<circle cx="32" cy="32" r="${r}" fill="none" stroke="rgba(255,255,255,.07)"/>`).join('')}
    <circle cx="32" cy="32" r="10" fill="#ff5cb0"/>
    <circle cx="32" cy="32" r="2" fill="#0a0812"/>
  </svg>`
  return wrap
}
