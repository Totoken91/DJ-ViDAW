/* ============================================================
   DJ ViDAW — MOTEUR DE TRANSPORT
   Scheduler a fenetre glissante : un timer imprecis (setInterval)
   place les evenements sur l'horloge audio, elle, precise.
   ============================================================ */

import type { Project, Note } from '../core/state'
import { STEPS_PER_BAR, patternSteps, songLengthSteps, clamp } from '../core/state'
import { buildGraph, type Graph } from './graph'
import { triggerNote, type SampleBank, type F32 } from './voices'
import { loadWorklets } from './fx'
import crusherSrc from '../worklets/crusher.js?raw'
import tapSrc from '../worklets/tap.js?raw'

export type PlayMode = 'pattern' | 'song'

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD = 0.14

export class Engine {
  ctx: AudioContext | null = null
  graph: Graph | null = null
  project: Project
  bank: SampleBank
  mode: PlayMode = 'pattern'
  playing = false
  step = 0
  private nextTime = 0
  private timer: number | null = null
  private originTime = 0
  private originStep = 0
  private tapNode: AudioWorkletNode | null = null
  private recChunks: { l: F32; r: F32 }[] = []
  recording = false
  onStep: ((step: number) => void) | null = null
  /** Appele a chaque changement lecture/arret : play() etant asynchrone,
      les appelants ne peuvent pas repeindre juste apres l'avoir invoque. */
  onState: (() => void) | null = null
  onError: ((msg: string) => void) | null = null
  private liveVoices = 0

  constructor(project: Project, bank: SampleBank) {
    this.project = project
    this.bank = bank
  }

  get ready() { return !!this.ctx }
  get stepDur() { return 60 / Math.max(20, this.project.bpm) / 4 }

  async init(): Promise<AudioContext> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume()
      return this.ctx
    }
    const Ctor: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctor({ latencyHint: 'interactive' })
    await loadWorklets(ctx, { crusher: crusherSrc, tap: tapSrc })
    this.ctx = ctx
    this.graph = buildGraph(ctx, this.project, true)
    // Tap d'enregistrement insere entre le master et la sortie
    try {
      const tap = new AudioWorkletNode(ctx, 'vidaw-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
      tap.port.onmessage = (e) => { if (this.recording) this.recChunks.push(e.data) }
      this.graph.postMaster.connect(tap)
      tap.connect(ctx.destination)
      this.tapNode = tap
    } catch {
      this.graph.postMaster.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') await ctx.resume()
    return ctx
  }

  sync() {
    if (!this.graph) return
    this.graph.applyMix(this.project)
    this.graph.updateFx(this.project)
  }

  /* -------------------- transport -------------------- */

  async play(mode?: PlayMode) {
    await this.init()
    if (mode) this.mode = mode
    if (this.playing) return
    const ctx = this.ctx!
    this.playing = true
    this.nextTime = ctx.currentTime + 0.06
    this.originTime = this.nextTime
    this.originStep = this.step
    this.sync()
    this.tick()
    this.timer = window.setInterval(() => this.tick(), LOOKAHEAD_MS)
    this.onState?.()
  }

  stop() {
    this.playing = false
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null }
    this.step = 0
    this.onStep?.(-1)
    this.onState?.()
  }

  pause() {
    this.playing = false
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null }
    this.onState?.()
  }

  toggle(mode?: PlayMode) {
    if (this.playing && (!mode || mode === this.mode)) this.stop()
    else if (this.playing && mode && mode !== this.mode) { this.stop(); void this.play(mode) }
    else void this.play(mode)
  }

  seek(step: number) {
    this.step = Math.max(0, Math.floor(step))
    if (!this.ctx) return
    // on recale l'origine pour que la tete de lecture affichee reste juste
    this.nextTime = this.ctx.currentTime + 0.04
    this.originTime = this.nextTime
    this.originStep = this.step
  }

  /** Pas actuellement entendu, deduit de l'horloge audio.
      C'est plus juste et bien moins couteux qu'un timer par pas. */
  get uiStep(): number {
    if (!this.ctx || !this.playing) return -1
    const n = this.originStep + Math.floor((this.ctx.currentTime - this.originTime) / this.stepDur)
    if (n < 0) return -1
    return ((n % this.loopLength()) + this.loopLength()) % this.loopLength()
  }

  private loopLength(): number {
    if (this.mode === 'song') return Math.max(STEPS_PER_BAR, songLengthSteps(this.project))
    const pat = this.project.patterns.find((x) => x.id === this.project.currentPattern)
    return pat ? patternSteps(pat) : STEPS_PER_BAR
  }

  private swingOffset(step: number): number {
    // le "shuffle" FL : on retarde les 1/16 impairs
    return step % 2 === 1 ? this.project.swing * this.stepDur : 0
  }

  private tick() {
    const ctx = this.ctx
    if (!ctx || !this.playing) return
    const horizon = ctx.currentTime + SCHEDULE_AHEAD
    const len = this.loopLength()
    let guard = 0
    while (this.nextTime < horizon && guard++ < 256) {
      const s = this.step % len
      this.fireStep(s, this.nextTime + this.swingOffset(s))
      this.nextTime += this.stepDur
      this.step++
    }
  }

  private fireStep(step: number, time: number) {
    const p = this.project
    const anySolo = p.channels.some((c) => c.solo)
    const emit = (n: Note) => {
      const ch = p.channels.find((c) => c.id === n.ch)
      if (!ch || ch.mute || (anySolo && !ch.solo)) return
      const strip = this.graph?.channels.get(ch.id)
      if (!strip) return
      if (this.liveVoices > 220) return   // garde-fou anti-explosion
      this.liveVoices++
      window.setTimeout(() => { this.liveVoices-- }, (n.len + 4) * this.stepDur * 1000 + 400)
      triggerNote(this.ctx!, strip.input, ch, n, time, this.bank, p.bpm, this.stepDur)
    }

    if (this.mode === 'pattern') {
      const pat = p.patterns.find((x) => x.id === p.currentPattern)
      if (!pat) return
      for (const n of pat.notes) if (n.t === step) emit(n)
    } else {
      for (const c of p.clips) {
        if (step < c.start || step >= c.start + c.len) continue
        const pat = p.patterns.find((x) => x.id === c.pat)
        if (!pat) continue
        const local = (step - c.start) % patternSteps(pat)
        for (const n of pat.notes) if (n.t === local) emit(n)
      }
    }
  }

  /* Preecoute d'une note isolee (clic sur le piano roll, aperçu de channel) */
  async preview(chId: string, key = 60, len = 4, vel = 0.9) {
    await this.init()
    const ch = this.project.channels.find((c) => c.id === chId)
    if (!ch) return
    const strip = this.graph?.channels.get(ch.id)
    if (!strip) return
    const t = this.ctx!.currentTime + 0.01
    triggerNote(this.ctx!, strip.input, ch, { id: 'prev', ch: chId, t: 0, len, key, vel, slice: -1 },
      t, this.bank, this.project.bpm, this.stepDur)
  }

  /* -------------------- enregistrement live -------------------- */

  startRec() {
    if (!this.tapNode) { this.onError?.('Enregistrement live indisponible sur ce navigateur.'); return false }
    this.recChunks = []
    this.recording = true
    this.tapNode.port.postMessage({ rec: true })
    return true
  }

  stopRec(): { l: F32; r: F32; rate: number } | null {
    if (!this.recording || !this.tapNode) return null
    this.recording = false
    this.tapNode.port.postMessage({ rec: false })
    const chunks = this.recChunks
    this.recChunks = []
    if (!chunks.length) return null
    const total = chunks.reduce((a, c) => a + c.l.length, 0)
    const l = new Float32Array(total), r = new Float32Array(total)
    let o = 0
    for (const c of chunks) { l.set(c.l, o); r.set(c.r, o); o += c.l.length }
    return { l, r, rate: this.ctx!.sampleRate }
  }

  get position() {
    if (!this.ctx || !this.playing) return 0
    return clamp((this.ctx.currentTime - this.originTime) / this.stepDur, 0, Number.MAX_SAFE_INTEGER)
  }
}
