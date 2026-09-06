/* ============================================================
   DJ ViDAW — MODE DJ VITEAU : DEUX PLATINES ET UNE TABLE

   Une platine, ce n'est pas un lecteur avec un bouton lecture :
   c'est un disque qu'on touche. Ici, la main sur le plateau prend
   la main sur l'horloge — on freine, on pousse, on part en arriere.

   Le retour en arriere est le point delicat : un AudioBufferSourceNode
   ne sait pas lire a vitesse negative. On garde donc le morceau dans
   les deux sens et on bascule d'un tampon a l'autre quand la vitesse
   change de signe, avec un fondu de quelques millisecondes pour ne pas
   entendre le raccord.
   ============================================================ */

import { clamp } from '../core/state'
import { vinylNoise } from './fx'

/** Tours par seconde d'un 33 1/3 : la reference du plateau. */
export const RPS = 100 / 180

export interface BeatInfo { bpm: number; offset: number; confidence: number }

/* ------------------------------------------------------------------ */
/* Detection de tempo et de premier temps                              */
/* ------------------------------------------------------------------ */

/**
 * Tempo par autocorrelation d'une enveloppe d'attaques, puis phase par
 * peigne. Le poids logarithmique autour de 125 BPM evite l'erreur
 * classique du facteur deux — un morceau a 128 detecte a 64.
 */
export function analyzeBeat(buf: AudioBuffer): BeatInfo {
  const hop = 512
  const d0 = buf.getChannelData(0)
  const d1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : d0
  const bins = Math.floor(d0.length / hop)
  if (bins < 64) return { bpm: 120, offset: 0, confidence: 0 }

  // enveloppe d'energie, puis flux positif : ce sont les montees qui
  // marquent le temps, pas le niveau absolu
  const env = new Float32Array(bins)
  for (let i = 0; i < bins; i++) {
    let e = 0
    const s = i * hop
    for (let j = 0; j < hop; j++) { const v = (d0[s + j] + d1[s + j]) * 0.5; e += v * v }
    env[i] = Math.sqrt(e / hop)
  }
  const flux = new Float32Array(bins)
  let mean = 0
  for (let i = 1; i < bins; i++) { flux[i] = Math.max(0, env[i] - env[i - 1]); mean += flux[i] }
  mean /= bins
  for (let i = 0; i < bins; i++) flux[i] = Math.max(0, flux[i] - mean * 0.6)

  const binRate = buf.sampleRate / hop
  let bestBpm = 120, bestScore = -1
  for (let bpm = 68; bpm <= 190; bpm += 0.25) {
    const lag = (60 / bpm) * binRate
    if (lag < 2 || lag * 4 >= bins) continue
    let s = 0, n = 0
    // on additionne aussi le double et le quadruple du battement : un
    // morceau en 4/4 est plus regulier a la mesure qu'au temps
    for (const m of [1, 2, 4]) {
      const l = Math.round(lag * m)
      if (l * 2 >= bins) continue
      for (let i = 0; i + l < bins; i++) s += flux[i] * flux[i + l]
      n += bins - l
    }
    if (!n) continue
    s /= n
    // preference douce pour les tempos de piste de danse
    const w = Math.exp(-Math.pow(Math.log(bpm / 125), 2) / (2 * 0.28 * 0.28))
    const score = s * (0.45 + 0.55 * w)
    if (score > bestScore) { bestScore = score; bestBpm = bpm }
  }

  // phase : on cale un peigne de battements et on garde le decalage
  // qui ramasse le plus d'energie
  const lag = (60 / bestBpm) * binRate
  let bestOff = 0, bestSum = -1
  const steps = Math.max(2, Math.round(lag))
  for (let o = 0; o < steps; o++) {
    let s = 0
    for (let i = o; i < bins; i += lag) s += flux[Math.round(i)] || 0
    if (s > bestSum) { bestSum = s; bestOff = o }
  }
  let peak = 0
  for (const f of flux) if (f > peak) peak = f
  return {
    bpm: Math.round(bestBpm * 10) / 10,
    offset: bestOff / binRate,
    confidence: peak > 0 ? clamp(bestSum / (peak * (bins / lag)), 0, 1) : 0,
  }
}

/** Pics min/max a resolution fixe (colonnes par seconde), calcules une
    fois au chargement. C'est ce qui permet de repeindre la vue zoomee a
    60 images par seconde sans relire le tampon. */
function finePeaks(buf: AudioBuffer, perSec: number): Float32Array {
  const cols = Math.max(1, Math.ceil(buf.duration * perSec))
  const out = new Float32Array(cols * 2)
  const d = buf.getChannelData(0)
  const step = d.length / cols
  for (let i = 0; i < cols; i++) {
    const a = Math.floor(i * step)
    const b = Math.min(d.length, Math.floor((i + 1) * step))
    let mn = 0, mx = 0
    for (let j = a; j < b; j++) { const v = d[j]; if (v < mn) mn = v; else if (v > mx) mx = v }
    out[i * 2] = mn
    out[i * 2 + 1] = mx
  }
  return out
}

/** Tampon lu a l'envers, pour le retour en arriere du plateau. */
function reverseBuffer(ctx: BaseAudioContext, buf: AudioBuffer): AudioBuffer {
  const r = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const s = buf.getChannelData(c), d = r.getChannelData(c)
    for (let i = 0, n = buf.length; i < n; i++) d[i] = s[n - 1 - i]
  }
  return r
}

/* ------------------------------------------------------------------ */
/* Une platine                                                         */
/* ------------------------------------------------------------------ */

export interface DeckEq { lo: number; mid: number; hi: number }

export class Deck {
  name = ''
  buffer: AudioBuffer | null = null
  private rev: AudioBuffer | null = null
  peaks: Float32Array | null = null
  /** Pics fins pour la vue zoomee, en paires min/max.
      Sans eux, dessiner huit secondes d'onde a chaque image relisait
      350 000 echantillons soixante fois par seconde, par platine. */
  zoom: Float32Array | null = null
  /** Colonnes de `zoom` par seconde. */
  zoomRate = 0
  beat: BeatInfo = { bpm: 120, offset: 0, confidence: 0 }

  playing = false
  pitch = 0                 // -0.16 .. 0.16
  keyLock = false           // affichage seulement : le ruban change la hauteur
  cue = 0                   // point de repere, en secondes
  hotCues: (number | null)[] = [null, null, null, null]
  loop: { a: number; b: number } | null = null
  private loopBeats = 0

  /* --- graphe --- */
  readonly input: GainNode
  readonly trim: GainNode
  private eqLo: BiquadFilterNode
  private eqMid: BiquadFilterNode
  private eqHi: BiquadFilterNode
  private lp: BiquadFilterNode
  private hp: BiquadFilterNode
  private echoSend: GainNode
  private echo: DelayNode
  private echoFb: GainNode
  private echoTone: BiquadFilterNode
  readonly volume: GainNode
  readonly out: GainNode
  readonly analyser: AnalyserNode
  private vinyl: { gain: GainNode; stop(): void } | null = null

  /* --- lecture --- */
  private node: AudioBufferSourceNode | null = null
  private nodeGain: GainNode
  private reversed = false
  private anchorPos = 0
  private anchorTime = 0
  private curRate = 0
  scratching = false

  onLoad: (() => void) | null = null

  constructor(public readonly ctx: AudioContext, public readonly id: 'A' | 'B') {
    const c = ctx
    this.input = c.createGain()
    this.nodeGain = c.createGain()
    this.trim = c.createGain(); this.trim.gain.value = 1

    this.eqLo = c.createBiquadFilter(); this.eqLo.type = 'lowshelf'; this.eqLo.frequency.value = 90
    this.eqMid = c.createBiquadFilter(); this.eqMid.type = 'peaking'; this.eqMid.frequency.value = 1000; this.eqMid.Q.value = 0.75
    this.eqHi = c.createBiquadFilter(); this.eqHi.type = 'highshelf'; this.eqHi.frequency.value = 7000

    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000; this.lp.Q.value = 1
    this.hp = c.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 20; this.hp.Q.value = 1

    this.echoSend = c.createGain(); this.echoSend.gain.value = 0
    this.echo = c.createDelay(2)
    this.echoFb = c.createGain(); this.echoFb.gain.value = 0.42
    this.echoTone = c.createBiquadFilter(); this.echoTone.type = 'lowpass'; this.echoTone.frequency.value = 3800
    this.echo.connect(this.echoTone).connect(this.echoFb).connect(this.echo)

    this.volume = c.createGain(); this.volume.gain.value = 0.85
    this.out = c.createGain()
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0.55

    this.nodeGain.connect(this.input)
    this.input.connect(this.trim)
      .connect(this.eqLo).connect(this.eqMid).connect(this.eqHi)
      .connect(this.lp).connect(this.hp)
      .connect(this.volume)
    this.volume.connect(this.out)
    this.volume.connect(this.echoSend).connect(this.echo)
    this.echoTone.connect(this.out)
    this.out.connect(this.analyser)
  }

  /* ---------------- chargement ---------------- */

  load(buf: AudioBuffer, name: string, peaks?: Float32Array) {
    const wasPlaying = this.playing
    this.stopNode()
    this.buffer = buf
    this.rev = null
    this.name = name
    this.peaks = peaks ?? null
    this.zoomRate = 400
    this.zoom = finePeaks(buf, this.zoomRate)
    this.beat = analyzeBeat(buf)
    this.anchorPos = 0
    this.anchorTime = this.ctx.currentTime
    this.cue = 0
    this.hotCues = [null, null, null, null]
    this.loop = null
    this.loopBeats = 0
    this.playing = false
    if (wasPlaying) this.playing = false
    this.onLoad?.()
  }

  /** Le tampon a l'envers n'est calcule que si on en a besoin. */
  private reverseOf(): AudioBuffer | null {
    if (!this.buffer) return null
    if (!this.rev) this.rev = reverseBuffer(this.ctx, this.buffer)
    return this.rev
  }

  get duration() { return this.buffer?.duration ?? 0 }

  /** Tempo reellement entendu, pitch compris. */
  get bpm() { return this.beat.bpm * (1 + this.pitch) }

  /** Position de lecture en secondes. Exacte tant que la vitesse est
      constante par morceaux — c'est le cas : on ne fait jamais de rampe. */
  get position(): number {
    if (!this.buffer) return 0
    if (!this.node) return this.anchorPos
    let p = this.anchorPos + (this.ctx.currentTime - this.anchorTime) * this.curRate
    if (this.loop) {
      const len = this.loop.b - this.loop.a
      if (len > 0.01 && p >= this.loop.a) p = this.loop.a + ((p - this.loop.a) % len + len) % len
    }
    return clamp(p, 0, this.duration)
  }

  /** Vitesse demandee par le fader (hors scratch). */
  private get faderRate() { return this.playing ? 1 + this.pitch : 0 }

  /* ---------------- moteur ---------------- */

  private stopNode() {
    if (!this.node) return
    try { this.node.stop() } catch { /* deja arrete */ }
    this.node.disconnect()
    this.node = null
  }

  /** (Re)demarre la source a la position courante, dans le bon sens. */
  private restart(rate: number) {
    const buf = this.buffer
    if (!buf) return
    const pos = clamp(this.position, 0, buf.duration - 0.001)
    this.stopNode()
    const back = rate < 0
    const play = back ? this.reverseOf() : buf
    if (!play) return
    const n = this.ctx.createBufferSource()
    n.buffer = play
    n.playbackRate.value = Math.max(0.0001, Math.abs(rate))
    if (this.loop && !back) {
      n.loop = true
      n.loopStart = this.loop.a
      n.loopEnd = Math.max(this.loop.a + 0.02, this.loop.b)
    }
    // Fondu de 4 ms : sans lui, chaque changement de sens claque.
    const t = this.ctx.currentTime
    this.nodeGain.gain.cancelScheduledValues(t)
    this.nodeGain.gain.setValueAtTime(0, t)
    this.nodeGain.gain.linearRampToValueAtTime(1, t + 0.004)
    n.connect(this.nodeGain)
    n.onended = () => {
      if (this.node === n && !n.loop && !this.scratching) { this.playing = false; this.setRate(0) }
    }
    n.start(0, back ? Math.max(0, buf.duration - pos) : pos)
    this.node = n
    this.reversed = back
    this.anchorPos = pos
    this.anchorTime = t
    this.curRate = rate
  }

  /** Change la vitesse. Un changement de sens impose de relancer la
      source sur l'autre tampon ; sinon on ne touche qu'un parametre. */
  private setRate(rate: number) {
    const r = clamp(rate, -4, 4)
    if (!this.buffer) { this.curRate = 0; return }
    const stopped = Math.abs(r) < 0.001
    if (stopped) {
      this.anchorPos = this.position
      this.anchorTime = this.ctx.currentTime
      this.curRate = 0
      this.stopNode()
      return
    }
    const dirChanged = (r < 0) !== this.reversed
    if (!this.node || dirChanged) { this.restart(r); return }
    // on fige la position atteinte avec l'ancienne vitesse avant de changer
    this.anchorPos = this.position
    this.anchorTime = this.ctx.currentTime
    this.curRate = r
    this.node.playbackRate.setValueAtTime(Math.abs(r), this.anchorTime)
  }

  /** Recalcule la vitesse a partir de l'etat (lecture, pitch, scratch). */
  private refreshRate() { if (!this.scratching) this.setRate(this.faderRate) }

  /* ---------------- transport ---------------- */

  play() {
    if (!this.buffer || this.playing) return
    this.playing = true
    this.refreshRate()
  }

  pause() {
    if (!this.playing) return
    this.playing = false
    this.refreshRate()
  }

  toggle() { this.playing ? this.pause() : this.play() }

  seek(sec: number) {
    if (!this.buffer) return
    this.anchorPos = clamp(sec, 0, this.duration)
    this.anchorTime = this.ctx.currentTime
    if (this.node || this.playing) this.restart(this.curRate || this.faderRate)
    else { this.stopNode(); this.curRate = 0 }
  }

  setPitch(p: number) {
    this.pitch = clamp(p, -0.5, 0.5)
    if (this.playing && !this.scratching) {
      // pas de relance : on ne fait que corriger l'ancre puis la vitesse
      this.setRate(this.faderRate)
    }
  }

  /** CUE facon platine CD : appui = on saute au repere et ca joue,
      relachement = retour au repere, a l'arret. */
  cuePress() {
    if (!this.buffer) return
    if (this.playing) { this.pause(); this.seek(this.cue); return }
    this.seek(this.cue)
    this.playing = true
    this.refreshRate()
  }

  cueRelease() {
    if (!this.buffer || !this.playing) return
    this.playing = false
    this.seek(this.cue)
  }

  setCueHere() { this.cue = this.position }

  hotCue(i: number, set = false) {
    if (!this.buffer) return
    if (set || this.hotCues[i] === null) { this.hotCues[i] = this.position; return }
    this.seek(this.hotCues[i]!)
    if (!this.playing) { this.playing = true; this.refreshRate() }
  }

  clearHotCue(i: number) { this.hotCues[i] = null }

  /* ---------------- boucle ---------------- */

  setLoopBeats(beats: number) {
    if (!this.buffer) return
    const len = (60 / Math.max(20, this.beat.bpm)) * beats
    const a = this.nearestBeat(this.position)
    this.loop = { a, b: Math.min(this.duration, a + len) }
    this.loopBeats = beats
    if (this.node) this.restart(this.curRate)
  }

  get loopLength() { return this.loopBeats }

  clearLoop() {
    if (!this.loop) return
    this.loop = null
    this.loopBeats = 0
    if (this.node) this.restart(this.curRate)
  }

  /** Temps du battement le plus proche, d'apres la grille detectee. */
  nearestBeat(sec: number): number {
    const per = 60 / Math.max(20, this.beat.bpm)
    const n = Math.round((sec - this.beat.offset) / per)
    return clamp(this.beat.offset + n * per, 0, this.duration)
  }

  /* ---------------- plateau ---------------- */

  /** Le disque passe sous la main : on prend le controle de la vitesse. */
  touch() {
    if (!this.buffer) return
    this.scratching = true
    this.setRate(0)
  }

  /** vitesse en « tours de plateau par seconde », rapportee au 33 tours. */
  scrub(revsPerSec: number) {
    if (!this.scratching) return
    this.setRate(clamp(revsPerSec / RPS, -4, 4))
  }

  /** Main levee : le disque reprend sa vitesse de croisiere. */
  release() {
    if (!this.scratching) return
    this.scratching = false
    this.setRate(this.faderRate)
  }

  /** Petit coup en avant ou en arriere sans lever la main (beatmatch). */
  nudge(dir: number, on: boolean) {
    if (this.scratching || !this.playing) return
    this.setRate(on ? this.faderRate * (1 + dir * 0.14) : this.faderRate)
  }

  /* ---------------- effets de jeu ---------------- */

  private brakeTimer = 0
  private rolling: { from: number; at: number; rate: number } | null = null
  reversing = false

  /** Frein de plateau : la vitesse tombe a zero en glissant, comme quand
      on coupe le moteur d'une platine. La descente est faite de paliers —
      la position reste donc calculable exactement. */
  brake(on: boolean, seconds = 0.7) {
    window.clearInterval(this.brakeTimer)
    if (!this.buffer) return
    const target = on ? 0 : this.faderRate
    const start = this.curRate
    const t0 = performance.now()
    const ms = Math.max(80, seconds * 1000)
    this.brakeTimer = window.setInterval(() => {
      const k = clamp((performance.now() - t0) / ms, 0, 1)
      // courbe en cloche : ca ralentit d'abord doucement puis d'un coup
      const e = on ? Math.pow(1 - k, 2) : 1 - Math.pow(1 - k, 2)
      this.setRate(on ? start * e : target * e)
      if (k >= 1) {
        window.clearInterval(this.brakeTimer)
        this.brakeTimer = 0
        if (on) { this.playing = false; this.setRate(0) }
      }
    }, 25)
  }

  /** Lecture a l'envers sans lacher le disque. */
  setReverse(on: boolean) {
    if (!this.buffer) return
    this.reversing = on
    if (!this.scratching) this.setRate(on ? -Math.max(0.05, this.faderRate || 1) : this.faderRate)
  }

  /** Roulement : une boucle courte le temps d'un appui. En relachant, on
      repart la ou le morceau serait s'il n'avait jamais boucle — c'est ce
      qui rend l'effet utilisable en plein mix. */
  rollStart(beats: number) {
    if (!this.buffer || this.rolling) return
    this.rolling = { from: this.position, at: this.ctx.currentTime, rate: this.curRate || this.faderRate }
    this.setLoopBeats(beats)
  }

  rollEnd() {
    const r = this.rolling
    this.rolling = null
    if (!r) return
    const elapsed = (this.ctx.currentTime - r.at) * r.rate
    this.loop = null
    this.seek(clamp(r.from + elapsed, 0, this.duration))
  }

  get rolling_() { return !!this.rolling }

  /* ---------------- table de mixage ---------------- */

  setEq(e: DeckEq, kill: { lo: boolean; mid: boolean; hi: boolean }) {
    this.eqLo.gain.value = kill.lo ? -40 : clamp(e.lo, -30, 10)
    this.eqMid.gain.value = kill.mid ? -40 : clamp(e.mid, -30, 10)
    this.eqHi.gain.value = kill.hi ? -40 : clamp(e.hi, -30, 10)
  }

  /** Un seul potard, deux filtres : a gauche on ferme, a droite on ouvre. */
  setFilter(v: number) {
    const x = clamp(v, -1, 1)
    if (x < -0.02) {
      this.lp.frequency.value = 20000 * Math.pow(120 / 20000, -x)
      this.lp.Q.value = 1 + -x * 6
      this.hp.frequency.value = 20
    } else if (x > 0.02) {
      this.hp.frequency.value = 20 * Math.pow(6000 / 20, x)
      this.hp.Q.value = 1 + x * 6
      this.lp.frequency.value = 20000
    } else {
      this.lp.frequency.value = 20000; this.lp.Q.value = 1
      this.hp.frequency.value = 20; this.hp.Q.value = 1
    }
  }

  setVolume(v: number) { this.volume.gain.value = clamp(v, 0, 1.2) }
  setTrim(v: number) { this.trim.gain.value = clamp(v, 0, 2) }

  /** Echo cale sur le tempo de la platine : un huitieme de mesure. */
  setEcho(mix: number, div = 0.5) {
    this.echoSend.gain.value = clamp(mix, 0, 1) * 0.9
    this.echo.delayTime.value = clamp((60 / Math.max(40, this.bpm)) * div, 0.01, 2)
    this.echoFb.gain.value = 0.3 + clamp(mix, 0, 1) * 0.32
  }

  setVinyl(level: number) {
    if (level <= 0.001) {
      if (this.vinyl) { this.vinyl.stop(); this.vinyl.gain.disconnect(); this.vinyl = null }
      return
    }
    if (!this.vinyl) this.vinyl = vinylNoise(this.ctx, this.out, level)
    this.vinyl.gain.gain.value = level * 0.5
  }

  dispose() {
    window.clearInterval(this.brakeTimer)
    this.stopNode()
    this.vinyl?.stop()
    this.out.disconnect()
  }
}

/* ------------------------------------------------------------------ */
/* La table : crossfader, master, enregistrement                       */
/* ------------------------------------------------------------------ */

export type XfCurve = 'douce' | 'lineaire' | 'coupe'

export class DjRig {
  readonly a: Deck
  readonly b: Deck
  private xa: GainNode
  private xb: GainNode
  readonly master: GainNode
  readonly analyser: AnalyserNode
  private limiter: DynamicsCompressorNode
  xfade = 0.5
  curve: XfCurve = 'douce'

  /* --- enregistrement du mix --- */
  private tap: AudioWorkletNode | null = null
  private chunks: { l: Float32Array; r: Float32Array }[] = []
  recording = false

  constructor(public readonly ctx: AudioContext, dest: AudioNode) {
    this.a = new Deck(ctx, 'A')
    this.b = new Deck(ctx, 'B')
    this.xa = ctx.createGain()
    this.xb = ctx.createGain()
    this.master = ctx.createGain()
    this.master.gain.value = 0.9
    this.limiter = ctx.createDynamicsCompressor()
    this.limiter.threshold.value = -1.5; this.limiter.knee.value = 0; this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.16
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0.55

    this.a.out.connect(this.xa).connect(this.master)
    this.b.out.connect(this.xb).connect(this.master)
    this.master.connect(this.limiter).connect(this.analyser)

    // Le tap est insere DANS le chemin du son. Branche en derivation, il
    // ne serait jamais appele : un noeud qui ne mene nulle part ne tourne
    // pas.
    try {
      const t = new AudioWorkletNode(ctx, 'vidaw-tap', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      })
      t.port.onmessage = (e) => { if (this.recording) this.chunks.push(e.data) }
      this.limiter.connect(t)
      t.connect(dest)
      this.tap = t
    } catch {
      this.limiter.connect(dest)
    }
    this.setXfade(0.5)
  }

  get canRecord() { return !!this.tap }

  /** Secondes deja capturees. */
  get recorded() {
    return this.chunks.reduce((a, c) => a + c.l.length, 0) / this.ctx.sampleRate
  }

  startRec(): boolean {
    if (!this.tap) return false
    this.chunks = []
    this.recording = true
    this.tap.port.postMessage({ rec: true })
    return true
  }

  stopRec(): AudioBuffer | null {
    if (!this.recording || !this.tap) return null
    this.recording = false
    this.tap.port.postMessage({ rec: false })
    const chunks = this.chunks
    this.chunks = []
    if (!chunks.length) return null
    const total = chunks.reduce((a, c) => a + c.l.length, 0)
    const buf = this.ctx.createBuffer(2, total, this.ctx.sampleRate)
    const l = buf.getChannelData(0), r = buf.getChannelData(1)
    let o = 0
    for (const c of chunks) { l.set(c.l, o); r.set(c.r, o); o += c.l.length }
    return buf
  }

  /** Trois lois de melange : la douce pour mixer, la coupe pour scratcher. */
  setXfade(x: number, curve = this.curve) {
    this.xfade = clamp(x, 0, 1)
    this.curve = curve
    const p = this.xfade
    let ga: number, gb: number
    if (curve === 'lineaire') { ga = 1 - p; gb = p }
    else if (curve === 'coupe') {
      // presque tout ou rien : les deux voies sont pleines des qu'on
      // quitte le bord, c'est ce qui permet de couper au rythme
      ga = p < 0.94 ? 1 : (1 - p) / 0.06
      gb = p > 0.06 ? 1 : p / 0.06
    } else {
      ga = Math.cos((p * Math.PI) / 2)
      gb = Math.cos(((1 - p) * Math.PI) / 2)
    }
    this.xa.gain.value = clamp(ga, 0, 1)
    this.xb.gain.value = clamp(gb, 0, 1)
  }

  setMaster(v: number) { this.master.gain.value = clamp(v, 0, 1.6) }

  /** Cale la platine cible sur l'autre : tempo puis phase. */
  sync(target: 'A' | 'B') {
    const dst = target === 'A' ? this.a : this.b
    const src = target === 'A' ? this.b : this.a
    if (!dst.buffer || !src.buffer || dst.beat.bpm < 20) return false
    const wanted = src.bpm
    const p = clamp(wanted / dst.beat.bpm - 1, -0.5, 0.5)
    dst.setPitch(p)
    // phase : on aligne le prochain temps de la cible sur celui de la source
    const per = 60 / Math.max(20, dst.bpm)
    const dstPhase = (dst.position - dst.beat.offset) % per
    const srcPer = 60 / Math.max(20, src.bpm)
    const srcPhase = (src.position - src.beat.offset) % srcPer
    let delta = srcPhase - dstPhase
    if (delta > per / 2) delta -= per
    if (delta < -per / 2) delta += per
    dst.seek(dst.position + delta)
    return true
  }

  dispose() {
    this.a.dispose(); this.b.dispose()
    this.master.disconnect(); this.limiter.disconnect()
  }
}
