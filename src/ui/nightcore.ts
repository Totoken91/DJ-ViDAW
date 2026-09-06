/* ============================================================
   DJ ViDAW — MODE NIGHTCORIFICATION
   Un applet complet : on depose un morceau, on choisit un preset,
   on affine, on ecoute en direct, on exporte.
   ============================================================ */

import { h, clear, drag } from './dom'
import { icon } from './icons'
import { knob } from './knob'
import { emptyState } from './shell'
import { eqView, BAND_COLORS, type EqView } from './eqview'
import { EQ_PRESETS, BAND_NAMES } from '../audio/eq'
import type { Ctx } from './ctx'
import { computePeaks, guessBpm, type StoredSample } from '../audio/samples'
import {
  NcPlayer, NC_PRESETS, defaultNc, rates, semitonesOf, renderNc,
  type NcSettings,
} from '../audio/nightcore'
import { clamp, makeChannel } from '../core/state'

const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export class Nightcore {
  el: HTMLElement
  private scroll: HTMLElement
  private player: NcPlayer | null = null
  private buffer: AudioBuffer | null = null
  private peaks: Float32Array | null = null
  private trackName = ''
  private srcBpm = 0
  private s: NcSettings = defaultNc()
  private waveCv: HTMLCanvasElement | null = null
  private raf = 0
  private preset = 0
  private cells: Record<string, HTMLElement> = {}
  private playBtn: HTMLElement | null = null
  private eq: EqView | null = null
  private eqRows: HTMLElement[] = []
  private analyser: AnalyserNode | null = null
  private loop: [number, number] | null = null
  private fileInput: HTMLInputElement

  constructor(private ctx: Ctx) {
    this.fileInput = h('input', { type: 'file', accept: 'audio/*', style: { display: 'none' } }) as HTMLInputElement
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files?.[0]
      if (f) void this.load(f)
      this.fileInput.value = ''
    })

    this.scroll = h('div', { class: 'nc-scroll' })
    this.el = h('div', { class: 'nc' }, this.bar(), this.scroll, this.fileInput)
    this.renderEmpty()
    this.tick()
  }

  private bar(): HTMLElement {
    return h('div', { class: 'app-head nc-bar' },
      icon('moon', 18),
      h('span', { class: 'app-title' }, 'NIGHTCORIFICATION'),
      h('span', { class: 'app-sub' }, 'on accelere, ca monte — c\'est tout le secret'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'nc-btn', onclick: () => this.fileInput.click() }, icon('folder'), 'OUVRIR UN MORCEAU'),
    )
  }

  /* ---------------- import ---------------- */

  private renderEmpty() {
    clear(this.scroll)
    const drop = emptyState({
      icon: 'moon', drop: true,
      title: 'DEPOSE UN MORCEAU ICI',
      line: 'wav · mp3 · ogg · flac · m4a — il sera accelere, la voix montera, et une reverbe rendra le tout beaucoup plus dramatique que necessaire.',
      onClick: () => this.fileInput.click(),
    })
    const stop = (e: Event) => { e.preventDefault(); e.stopPropagation() }
    for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { stop(e); drop.classList.add('hover') })
    for (const t of ['dragleave', 'drop']) drop.addEventListener(t, (e) => { stop(e); drop.classList.remove('hover') })
    drop.addEventListener('drop', (e) => {
      const f = (e as DragEvent).dataTransfer?.files?.[0]
      if (f) void this.load(f)
    })

    this.scroll.appendChild(drop)
    this.scroll.appendChild(h('div', {
      class: 'nc-note',
      style: { textAlign: 'center', maxWidth: '460px', margin: '0 auto' },
    }, 'Tu peux aussi reprendre un sample deja importe : ',
      ...this.ctx.samples.list().slice(0, 6).map((sm) =>
        h('button', {
          class: 'nc-btn', style: { margin: '3px' },
          onclick: () => this.adopt(sm.name, sm.buffer, sm.peaks),
        }, icon('wave'), sm.name.slice(0, 18))),
      this.ctx.samples.list().length ? null : h('i', {}, 'aucun pour l\'instant.')))
  }

  /** Accepte aussi un fichier depose sur le bureau. */
  async load(file: File) {
    const actx = await this.ctx.engine.init()
    try {
      const buf = await actx.decodeAudioData(await file.arrayBuffer())
      this.adopt(file.name.replace(/\.[^.]+$/, ''), buf)
      this.ctx.say('Morceau charge. Clique un preset, ecoute, et regle la vitesse au gros bouton.')
    } catch {
      this.ctx.dialog({ title: 'Lecture impossible', icon: 'help', body: `Impossible de decoder "${file.name}".` })
    }
  }

  private adopt(name: string, buf: AudioBuffer, peaks?: Float32Array) {
    this.player?.dispose()
    this.buffer = buf
    this.peaks = peaks ?? computePeaks(buf, 1600)
    this.trackName = name
    this.srcBpm = guessBpm(buf)
    this.loop = null
    const actx = this.ctx.engine.ctx
    if (actx) {
      this.player = new NcPlayer(actx, buf, this.s)
      // Un analyseur a nous : la courbe d'EQ montre le spectre reel de ce
      // qui sort de la chaine, pas une devinette. On garde aussi celui du
      // projet pour que le vu-metre de la barre du haut continue de vivre.
      const an = actx.createAnalyser()
      an.fftSize = 2048
      an.smoothingTimeConstant = 0.72
      this.analyser = an
      const fan = actx.createGain()
      fan.connect(an)
      const master = this.ctx.engine.graph?.analyser
      if (master) fan.connect(master)
      this.player.tap = fan
      this.eq?.setAnalyser(an)
      this.player.onEnd = () => this.paintTransport()
    }
    this.applyPreset(0)
    this.renderEditor()
  }

  /* ---------------- editeur ---------------- */

  private renderEditor() {
    clear(this.scroll)
    if (!this.buffer) { this.renderEmpty(); return }

    const cv = h('canvas') as HTMLCanvasElement
    this.waveCv = cv
    const wave = h('div', { class: 'nc-wave' }, cv)
    this.bindWave(wave, cv)

    const cell = (key: string, label: string, hot = false) => {
      const b = h('b', {}, '—')
      this.cells[key] = b
      return h('div', { class: `nc-cell${hot ? ' hot' : ''}` }, h('u', {}, label), b)
    }

    const readout = h('div', { class: 'nc-readout' },
      cell('speed', 'vitesse', true),
      cell('semis', 'hauteur', true),
      cell('dur', 'duree'),
      cell('bpm', 'tempo'),
      cell('pos', 'lecture'),
    )

    const presets = h('div', { class: 'nc-presets' },
      ...NC_PRESETS.map((p, i) => h('button', {
        class: `nc-preset${i === this.preset ? ' on' : ''}`,
        onclick: () => { this.applyPreset(i); this.renderEditor() },
      }, h('b', {}, p.name), h('i', {}, p.tag))))

    /* --- gros bouton de vitesse --- */
    const bigKnob = knob({
      min: 0.5, max: 2, value: this.s.speed, def: 1.3, size: 104, color: '#ff5cb0',
      format: (v) => `${v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}x`,
      onInput: (v) => { this.s.speed = v; this.push() },
    })

    const modeBtn = (m: 'tape' | 'free', label: string, title: string) =>
      h('button', {
        class: `nc-btn${this.s.mode === m ? ' on' : ''}`, title,
        onclick: () => { this.s.mode = m; this.push(); this.renderEditor() },
      }, label)

    const pitchKnob = knob({
      min: -12, max: 12, value: this.s.pitch, def: 0, size: 46, label: 'HAUTEUR', color: '#5fe6ff',
      format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`,
      onInput: (v) => { this.s.pitch = v; this.push() },
    })

    const big = h('div', { class: 'nc-bigknob' },
      h('span', { class: 'cap' }, 'VITESSE'),
      bigKnob,
      h('div', { class: 'nc-modes' },
        modeBtn('tape', 'RUBAN', 'La hauteur suit la vitesse, comme une cassette. Aucune degradation.'),
        modeBtn('free', 'LIBRE', 'Vitesse et hauteur separees, par recouvrement de grains. Ca gresille un peu.')),
      this.s.mode === 'free' ? pitchKnob : null,
      this.s.mode === 'free'
        ? h('div', { class: 'nc-note', style: { maxWidth: '150px', textAlign: 'center' } },
            'Mode granulaire : le son perd un peu en proprete.')
        : null,
    )

    const K = (label: string, min: number, max: number, get: () => number,
               set: (v: number) => void, def: number, curve = 1, fmt?: (v: number) => string) =>
      knob({
        min, max, value: get(), def, label, size: 44, curve, color: '#5fe6ff', format: fmt,
        onInput: (v) => { set(v); this.push() },
      })

    const space = h('div', { class: 'nc-group' },
      h('h4', {}, 'Espace'),
      h('div', { class: 'nc-knobs' },
        K('REVERBE', 0, 1, () => this.s.reverb, (v) => { this.s.reverb = v }, .22, 1, (v) => `${Math.round(v * 100)}%`),
        K('TAILLE', .3, 6, () => this.s.size, (v) => { this.s.size = v }, 2.2, 1.6, (v) => `${v.toFixed(1)}s`),
        K('LARGEUR', 0, 2, () => this.s.width, (v) => { this.s.width = v }, 1.25, 1, (v) => `${Math.round(v * 100)}%`),
        K('ROTATION', 0, 1.2, () => this.s.rotate, (v) => { this.s.rotate = v }, 0, 1.4,
          (v) => (v < .02 ? 'off' : `${v.toFixed(2)}Hz`)),
      ))

    const tone = h('div', { class: 'nc-group' },
      h('h4', {}, 'Matiere'),
      h('div', { class: 'nc-knobs' },
        K('COUPE-BAS', 15, 400, () => this.s.cut, (v) => { this.s.cut = v }, 30, 2, (v) => `${Math.round(v)}Hz`),
        K('SATURATION', 0, 1, () => this.s.drive, (v) => { this.s.drive = v }, .08, 1, (v) => `${Math.round(v * 100)}%`),
        K('WOBBLE', 0, 1, () => this.s.wobble, (v) => { this.s.wobble = v }, .06, 1, (v) => `${Math.round(v * 100)}%`),
        K('VOLUME', 0, 2, () => this.s.gain, (v) => { this.s.gain = v }, 1, 1, (v) => `${Math.round(v * 100)}%`),
      ))

    this.playBtn = h('button', { class: 'nc-btn go', onclick: () => this.toggle() }, icon('play'), 'ECOUTER')
    const loopBtn = h('button', {
      class: `nc-btn${this.loop ? ' on' : ''}`,
      title: 'Glisse sur la forme d\'onde pour choisir la boucle',
      onclick: () => { this.loop = null; if (this.player) this.player.loop = null; this.renderEditor() },
    }, icon('loop'), this.loop ? 'BOUCLE ACTIVE' : 'PAS DE BOUCLE')

    const actions = h('div', { class: 'nc-actions' },
      this.playBtn,
      h('button', { class: 'nc-btn', onclick: () => { this.player?.stop(); this.paintTransport() } }, icon('stop'), 'STOP'),
      loopBtn,
      h('div', { class: 'sep' }),
      h('button', { class: 'nc-btn cy', onclick: () => void this.exportTrack() }, icon('floppy'), 'EXPORTER'),
      h('button', { class: 'nc-btn', onclick: () => void this.toSampler() }, icon('rack'), 'ENVOYER AU SAMPLER'),
      h('div', { class: 'sep' }),
      h('button', { class: 'nc-btn', onclick: () => { this.player?.dispose(); this.player = null; this.buffer = null; this.renderEmpty() } },
        icon('close'), 'FERMER LE MORCEAU'),
    )

    this.scroll.append(
      h('div', {
        style: { font: '700 12px/1.4 Tahoma, sans-serif', marginBottom: '6px', color: '#e8dcff' },
      }, this.trackName),
      wave, readout, presets,
      h('div', { class: 'nc-main' }, big, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', flex: '1 1 320px' } }, space, tone)),
      this.eqPanel(),
      actions,
    )

    requestAnimationFrame(() => { this.paintWave(); this.paintReadout(); this.paintTransport() })
  }

  /* ---------------- egaliseur ---------------- */

  /** Le panneau d'egalisation. C'est ici qu'on va chercher le grave et
      qu'on empeche le morceau de s'etouffer quand on le ralentit. */
  private eqPanel(): HTMLElement {
    const view = eqView({
      bands: this.s.eq,
      onChange: () => { this.push(); this.paintEqRows() },
      onActive: (i) => this.highlightBand(i),
      height: 186,
    })
    this.eq = view
    view.setAnalyser(this.analyser)

    /* --- une ligne de valeurs par bande --- */
    this.eqRows = this.s.eq.map((b, i) => {
      const row = h('div', {
        class: 'eq-band',
        style: { '--bc': BAND_COLORS[i] },
        dataset: { tip: `${BAND_NAMES[i]} — clic pour couper la bande, clic droit pour son menu` },
        onclick: () => { b.on = !b.on; this.push(); this.paintEqRows(); view.draw() },
      },
        h('u', {}, `${i + 1} ${BAND_NAMES[i]}`),
        h('b', { class: 'g' }, '—'),
        h('i', { class: 'f' }, '—'),
      )
      return row
    })

    const presetSel = h('select', { class: 'sel', onchange: (e: Event) => {
      const el = e.target as HTMLSelectElement
      const p = EQ_PRESETS[el.selectedIndex - 1]
      el.selectedIndex = 0
      if (!p) return
      p.bands.forEach((g, i) => { if (this.s.eq[i]) { this.s.eq[i].g = g; this.s.eq[i].on = true } })
      view.invalidate()
      this.push(); this.paintEqRows(); view.draw()
      this.ctx.toast(`EQ : ${p.name}`)
    } },
      h('option', {}, 'COURBES TOUTES FAITES...'),
      ...EQ_PRESETS.map((p) => h('option', {}, `${p.name} — ${p.tag}`)),
    )

    const flat = h('button', {
      class: 'nc-btn', dataset: { tip: 'Remet les cinq bandes a plat' },
      onclick: () => {
        for (const b of this.s.eq) { b.g = 0; b.on = true }
        view.invalidate()
        this.push(); this.paintEqRows(); view.draw()
      },
    }, icon('broom', 12), 'A PLAT')

    const toggle = (label: string, tip: string, get: () => boolean, set: (v: boolean) => void) => {
      const b = h('button', {
        class: `nc-btn tog${get() ? ' on' : ''}`, dataset: { tip },
        onclick: () => { set(!get()); b.classList.toggle('on', get()); this.push() },
      }, h('i', { class: 'led' }), label)
      return b
    }

    const K = (label: string, min: number, max: number, get: () => number,
               set: (v: number) => void, def: number, fmt?: (v: number) => string) =>
      knob({
        min, max, value: get(), def, label, size: 44, color: '#ff5cb0', format: fmt,
        onInput: (v) => { set(v); this.push() },
      })

    const panel = h('div', { class: 'nc-group eq-group' },
      h('h4', {}, 'Egaliseur',
        h('span', { class: 'nc-note' }, 'attrape un point et deplace-le · molette = largeur · double-clic = a plat'),
        h('div', { class: 'spacer' }), presetSel, flat),
      view.el,
      h('div', { class: 'eq-bands' }, ...this.eqRows),
      h('div', { class: 'eq-tools' },
        K('BASCULE', -8, 8, () => this.s.tilt, (v) => { this.s.tilt = v }, 0,
          (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}dB`),
        toggle('AUTO', 'Compense automatiquement l\'assombrissement du a la vitesse : ralentir etouffe, accelerer rend criard',
          () => this.s.autoTilt, (v) => { this.s.autoTilt = v }),
        h('div', { class: 'sep' }),
        K('EXCITER', 0, 1, () => this.s.exciter, (v) => { this.s.exciter = v }, .12,
          (v) => `${Math.round(v * 100)}%`),
        K('COHESION', 0, 1, () => this.s.glue, (v) => { this.s.glue = v }, .2,
          (v) => `${Math.round(v * 100)}%`),
        h('div', { class: 'sep' }),
        toggle('NIVEAU AUTO', 'Retire le volume gagne par l\'egalisation : sans ca, « plus fort » passe toujours pour « mieux »',
          () => this.s.autoGain, (v) => { this.s.autoGain = v }),
        h('span', { class: 'nc-note', style: { maxWidth: '190px' } },
          'BASCULE ouvre ou assombrit tout le spectre d\'un geste. EXCITER refabrique les aigus qu\'un ralenti a manges.'),
      ),
    )
    requestAnimationFrame(() => { view.draw(); this.paintEqRows() })
    return panel
  }

  /** Met a jour les valeurs affichees sous la courbe. */
  private paintEqRows() {
    this.s.eq.forEach((b, i) => {
      const row = this.eqRows[i]
      if (!row) return
      row.classList.toggle('off', !b.on)
      const g = row.querySelector('.g') as HTMLElement
      const f = row.querySelector('.f') as HTMLElement
      g.textContent = `${b.g > 0 ? '+' : ''}${b.g.toFixed(1)} dB`
      f.textContent = b.f >= 1000 ? `${(b.f / 1000).toFixed(2)} kHz · Q ${b.q.toFixed(1)}`
        : `${Math.round(b.f)} Hz · Q ${b.q.toFixed(1)}`
    })
  }

  private highlightBand(i: number) {
    this.eqRows.forEach((r, k) => r.classList.toggle('hot', k === i))
  }

  private applyPreset(i: number) {
    const p = NC_PRESETS[clamp(i, 0, NC_PRESETS.length - 1)]
    this.preset = i
    // Copie profonde des bandes : sans ca, regler l'EQ modifierait le
    // preset lui-meme, et il ne reviendrait jamais a son etat d'origine.
    this.s = { ...defaultNc(), ...p.s, eq: (p.s.eq ?? defaultNc().eq).map((b) => ({ ...b })) }
    this.push()
  }

  /** Repercute les reglages sur la lecture en cours. */
  private push() {
    this.player?.apply(this.s)
    this.paintReadout()
  }

  private toggle() {
    if (!this.player) return
    if (this.player.playing) { this.player.stop(true); this.paintTransport(); return }
    this.player.loop = this.loop
    // l'etat ne devient "en lecture" qu'une fois le contexte audio pret :
    // repeindre avant la resolution laissait le bouton sur ECOUTER
    void this.ctx.engine.init().then(() => {
      this.player?.play()
      this.paintTransport()
    })
  }

  private paintTransport() {
    if (!this.playBtn) return
    const on = !!this.player?.playing
    clear(this.playBtn)
    this.playBtn.append(icon(on ? 'pause' : 'play'), document.createTextNode(on ? 'PAUSE' : 'ECOUTER'))
    this.playBtn.classList.toggle('on', on)
  }

  /* ---------------- affichage ---------------- */

  private paintReadout() {
    if (!this.buffer) return
    const { playback } = rates(this.s)
    const semis = this.s.mode === 'tape' ? semitonesOf(this.s.speed) : this.s.pitch
    const outDur = this.player ? this.player.duration : this.buffer.duration / this.s.speed
    const set = (k: string, v: string) => { if (this.cells[k]) this.cells[k].textContent = v }
    set('speed', `${this.s.speed.toFixed(2)}x`)
    set('semis', `${semis >= 0 ? '+' : ''}${semis.toFixed(1)} dt`)
    set('dur', `${fmtTime(this.buffer.duration)} → ${fmtTime(outDur)}`)
    set('bpm', this.srcBpm ? `${this.srcBpm} → ${Math.round(this.srcBpm * (this.buffer.duration / Math.max(0.01, outDur)))}` : '—')
    void playback
  }

  private tick = () => {
    this.raf = requestAnimationFrame(this.tick)
    if (!this.player || !this.buffer) return
    if (this.cells.pos) {
      const p = this.player.position
      this.cells.pos.textContent = `${fmtTime(p * this.player.duration)} / ${fmtTime(this.player.duration)}`
    }
    if (this.player.playing) { this.paintWave(); this.eq?.draw() }
  }

  dispose() { cancelAnimationFrame(this.raf); this.player?.dispose() }

  resize() { this.paintWave() }

  /** Appele a l'ouverture de la fenetre : la liste des samples deja
      importes a pu changer depuis la derniere fois. */
  refresh() {
    if (this.buffer) this.paintWave()
    else this.renderEmpty()
  }

  /** L'onde ne change pas d'une image a l'autre : on la peint une fois
      dans un canevas a part, et chaque image ne fait plus que la recopier
      avant d'y poser la boucle et la tete de lecture. Avant, c'etaient
      six cents rectangles et six cents couleurs analysees par image. */
  private waveCache: HTMLCanvasElement | null = null
  private waveKey = ''

  private buildWave(w: number, hh: number, dpr: number): HTMLCanvasElement {
    const key = `${w}x${hh}@${dpr}|${this.peaks?.length ?? 0}|${this.trackName}`
    if (this.waveCache && this.waveKey === key) return this.waveCache
    const cv = document.createElement('canvas')
    cv.width = Math.floor(w * dpr); cv.height = Math.floor(hh * dpr)
    const g = cv.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = '#100b22'; g.fillRect(0, 0, w, hh)
    g.fillStyle = 'rgba(255,255,255,.05)'
    for (let x = 0; x < w; x += 10) g.fillRect(x, 0, 1, hh)

    const peaks = this.peaks
    if (peaks) {
      const cols = peaks.length / 2
      const mid = hh / 2
      // Le degrade rose -> cyan est peint en une passe, en masquant la
      // silhouette : une couleur par pixel coutait six cents analyses
      // de chaine CSS par image.
      const grad = g.createLinearGradient(0, 0, w, 0)
      grad.addColorStop(0, 'rgb(255,92,176)')
      grad.addColorStop(1, 'rgb(95,230,255)')
      g.beginPath()
      for (let x = 0; x < w; x++) {
        const i = Math.min(cols - 1, Math.floor((x / w) * cols))
        const y0 = mid - peaks[i * 2 + 1] * mid * 0.9
        const y1 = mid - peaks[i * 2] * mid * 0.9
        g.rect(x, y0, 1, Math.max(1, y1 - y0))
      }
      g.fillStyle = grad
      g.fill()
    }
    this.waveCache = cv
    this.waveKey = key
    return cv
  }

  private paintWave() {
    const cv = this.waveCv
    if (!cv || !this.peaks) return
    const w = cv.clientWidth || 600, hh = cv.clientHeight || 116
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (cv.width !== Math.floor(w * dpr)) { cv.width = Math.floor(w * dpr); cv.height = Math.floor(hh * dpr) }
    const g = cv.getContext('2d')!
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, cv.width, cv.height)
    g.drawImage(this.buildWave(w, hh, dpr), 0, 0)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)

    if (this.loop) {
      const [a, b] = this.loop
      g.fillStyle = 'rgba(0,0,0,.55)'
      g.fillRect(0, 0, a * w, hh)
      g.fillRect(b * w, 0, w - b * w, hh)
      g.strokeStyle = '#5fe6ff'; g.lineWidth = 2
      g.beginPath(); g.moveTo(a * w, 0); g.lineTo(a * w, hh); g.moveTo(b * w, 0); g.lineTo(b * w, hh); g.stroke()
    }

    if (this.player) {
      const x = this.player.position * w
      g.fillStyle = '#fff'; g.fillRect(x - 1, 0, 2, hh)
      g.fillStyle = 'rgba(255,255,255,.9)'
      g.beginPath(); g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.lineTo(x, 7); g.fill()
    }
  }


  private bindWave(wrap: HTMLElement, cv: HTMLCanvasElement) {
    const at = (clientX: number) => {
      const r = cv.getBoundingClientRect()
      return clamp((clientX - r.left) / r.width, 0, 1)
    }
    let anchor = 0, moved = false
    drag(wrap, (_dx, _dy, e) => {
      const x = at(e.clientX)
      if (Math.abs(x - anchor) > 0.006) {
        moved = true
        this.loop = [Math.min(anchor, x), Math.max(anchor, x)]
        if (this.player) this.player.loop = this.loop
        this.paintWave()
      }
    }, (e) => {
      if (e.button === 2) return false
      anchor = at(e.clientX); moved = false
      return true
    }, (e) => {
      if (moved) {
        // une boucle vient d'etre tracee : on relit depuis son debut
        if (this.player?.playing) this.player.play(this.loop![0])
        this.renderEditor()
      } else {
        const x = at(e.clientX)
        if (this.player?.playing) this.player.play(x)
        else if (this.player) this.player.stop(true), (this.player as unknown as { offset: number }).offset = x
        this.paintWave()
      }
    })
    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this.loop = null
      if (this.player) this.player.loop = null
      this.renderEditor()
    })
  }

  /* ---------------- sorties ---------------- */

  private async render(onProgress: (p: number) => void): Promise<AudioBuffer | null> {
    if (!this.buffer) return null
    return renderNc(this.buffer, this.s, onProgress)
  }

  private async exportTrack() {
    if (!this.buffer) return
    const bar = h('i')
    const prog = h('div', { class: 'prog' }, bar)
    const status = h('div', { style: { marginTop: '6px', fontSize: '10px' } }, 'Rendu hors-ligne en cours...')
    this.ctx.dialog({
      title: 'Nightcorification', icon: 'moon',
      body: h('div', {}, h('div', { style: { marginBottom: '8px' } }, this.trackName), prog, status),
      buttons: [],
    })
    try {
      const buf = await this.render((p) => { bar.style.width = `${Math.round(p * 100)}%` })
      if (!buf) return
      const tag = NC_PRESETS[this.preset].name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      this.ctx.offerRender(buf, `${slugify(this.trackName)}_${tag}`, 'Nightcorification')
    } catch (e) {
      status.textContent = `Echec du rendu : ${String(e)}`
    }
  }

  private async toSampler() {
    if (!this.buffer) return
    this.ctx.toast('Rendu en cours...')
    const buf = await this.render(() => { /* pas de barre ici */ })
    if (!buf) return
    const sm: StoredSample = this.ctx.samples.add(`${this.trackName} NC`, buf)
    const ch = makeChannel('sampler', `${this.trackName.toUpperCase().slice(0, 14)} NC`, this.ctx.project.channels.length)
    ch.sampler!.sampleId = sm.id
    this.ctx.project.channels.push(ch)
    this.ctx.markDirty(); this.ctx.sync(); this.ctx.refresh('all')
    this.ctx.selectChannel(ch.id)
    this.ctx.toast('Ajoute comme channel sampler.')
    this.ctx.say('Il est dans le sequenceur. Decoupe-le, mets-le a l\'envers, fais n\'importe quoi.')
  }
}

const slugify = (s: string) => s.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'morceau'
