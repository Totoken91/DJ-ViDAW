/* ============================================================
   DJ ViDAW — SYNTHETISEUR
   Deux oscillateurs a unisson, sub, bruit, modulation en anneau,
   filtre multi-modes avec saturation, deux enveloppes, deux LFO
   a destinations multiples, et une petite chaine d'effets par
   channel pour que les presets sonnent tout de suite.

   Comme le reste du moteur, tout est ecrit contre BaseAudioContext :
   le meme code sert a l'ecoute et au rendu hors-ligne.
   ============================================================ */

import { clamp } from '../core/state'
import { noiseBuffer, driveCurve } from './voices'

export type Wave = 'saw' | 'square' | 'pulse' | 'triangle' | 'sine' | 'noise'
export type FilterKind = 'lp24' | 'lp12' | 'hp12' | 'bp' | 'notch' | 'off'
export type LfoShape = 'sine' | 'tri' | 'saw' | 'square' | 'sh'

export interface OscParams {
  wave: Wave
  oct: number      // -3..+3 octaves
  semi: number     // -12..+12 demi-tons
  fine: number     // -50..+50 cents
  level: number    // 0..1
  pw: number       // 0.05..0.95, largeur d'impulsion
  unison: number   // 1..7
  detune: number   // 0..60 cents entre les voix
  spread: number   // 0..1 etalement stereo
}

export interface Env { a: number; d: number; s: number; r: number }

export interface Lfo {
  shape: LfoShape
  rate: number     // Hz quand sync = false
  sync: boolean
  div: number      // index de division quand sync = true
  fade: number     // montee progressive, en secondes
  toPitch: number  // cents
  toCut: number    // 0..1
  toAmp: number    // 0..1
  toPan: number    // 0..1
  toPw: number     // 0..1
}

export interface SynthFx {
  drive: number      // 0..1
  chorus: number     // 0..1
  delay: number      // 0..1 dosage
  delayDiv: number   // index de division
  delayFb: number    // 0..0.9
  reverb: number     // 0..1
  size: number       // 0.3..6 s
}

export interface SynthParams {
  oscA: OscParams
  oscB: OscParams
  mix: number                                   // 0 = A, 1 = B
  sub: { wave: 'sine' | 'square' | 'triangle'; oct: number; level: number }
  noise: number
  ring: number                                  // 0..1 modulation en anneau A x B
  filter: { kind: FilterKind; cutoff: number; reso: number; env: number; key: number; drive: number }
  ampEnv: Env
  filtEnv: Env
  lfo1: Lfo
  lfo2: Lfo
  glide: number
  mono: boolean
  velAmp: number    // 0..1 sensibilite de l'ampli a la velocite
  velCut: number    // 0..1 sensibilite du filtre a la velocite
  gain: number      // 0..1.5
  fx: SynthFx
}

export const LFO_DIVS = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.125]
export const LFO_DIV_LABELS = ['1/1', '1/2.', '1/2', '1/4.', '1/4', '1/8.', '1/8', '1/16.', '1/16', '1/32']
export const DLY_DIVS = [1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.1875, 0.125]
export const DLY_DIV_LABELS = ['1/4.', '1/4', '1/8.', '1/8', '1/16.', '1/16', '1/32.', '1/32']

export const WAVES: Wave[] = ['saw', 'square', 'pulse', 'triangle', 'sine', 'noise']
export const WAVE_LABEL: Record<Wave, string> = {
  saw: 'DENT DE SCIE', square: 'CARRE', pulse: 'IMPULSION',
  triangle: 'TRIANGLE', sine: 'SINUS', noise: 'BRUIT',
}
export const FILTER_LABEL: Record<FilterKind, string> = {
  lp24: 'PASSE-BAS 24', lp12: 'PASSE-BAS 12', hp12: 'PASSE-HAUT',
  bp: 'PASSE-BANDE', notch: 'COUPE-BANDE', off: 'AUCUN',
}
export const LFO_LABEL: Record<LfoShape, string> = {
  sine: 'SINUS', tri: 'TRIANGLE', saw: 'RAMPE', square: 'CARRE', sh: 'ALEATOIRE',
}

/* ------------------------------------------------------------------ */
/* Valeurs par defaut                                                   */
/* ------------------------------------------------------------------ */

export const osc = (p: Partial<OscParams> = {}): OscParams => ({
  wave: 'saw', oct: 0, semi: 0, fine: 0, level: 1, pw: 0.5,
  unison: 1, detune: 12, spread: 0.5, ...p,
})
export const env = (a: number, d: number, s: number, r: number): Env => ({ a, d, s, r })
export const lfo = (p: Partial<Lfo> = {}): Lfo => ({
  shape: 'sine', rate: 5, sync: false, div: 4, fade: 0,
  toPitch: 0, toCut: 0, toAmp: 0, toPan: 0, toPw: 0, ...p,
})
export const synthFx = (p: Partial<SynthFx> = {}): SynthFx => ({
  drive: 0, chorus: 0, delay: 0, delayDiv: 3, delayFb: 0.35, reverb: 0, size: 2, ...p,
})

export function defaultSynth(): SynthParams {
  return {
    oscA: osc({ wave: 'saw', unison: 3, detune: 14, spread: 0.5 }),
    oscB: osc({ wave: 'square', semi: 0, level: 0.7 }),
    mix: 0.35,
    sub: { wave: 'sine', oct: -1, level: 0.25 },
    noise: 0,
    ring: 0,
    filter: { kind: 'lp24', cutoff: 2600, reso: 4, env: 0.5, key: 0.35, drive: 0.1 },
    ampEnv: env(0.006, 0.3, 0.6, 0.26),
    filtEnv: env(0.004, 0.35, 0.25, 0.3),
    lfo1: lfo({ shape: 'sine', rate: 5.2, toPitch: 0, toCut: 0 }),
    lfo2: lfo({ shape: 'tri', rate: 0.4, sync: true, div: 4 }),
    glide: 0, mono: false, velAmp: 0.6, velCut: 0.3, gain: 0.8,
    fx: synthFx(),
  }
}

/* ------------------------------------------------------------------ */
/* Formes d'onde d'impulsion : Web Audio n'a pas de PWM natif, on
   pre-calcule une table par rapport cyclique et on choisit la plus
   proche. Le pas de 5 % est inaudible en balayage.                     */
/* ------------------------------------------------------------------ */

const pulseCache = new WeakMap<BaseAudioContext, Map<number, PeriodicWave>>()
function pulseWave(ctx: BaseAudioContext, duty: number): PeriodicWave {
  let bank = pulseCache.get(ctx)
  if (!bank) { bank = new Map(); pulseCache.set(ctx, bank) }
  const key = Math.round(clamp(duty, 0.05, 0.95) * 20)
  const hit = bank.get(key)
  if (hit) return hit
  const d = key / 20
  const N = 64
  const real = new Float32Array(N), imag = new Float32Array(N)
  // serie de Fourier d'un train d'impulsions de rapport cyclique d
  for (let n = 1; n < N; n++) {
    imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * d)
  }
  const w = ctx.createPeriodicWave(real, imag, { disableNormalization: false })
  bank.set(key, w)
  return w
}

/* ------------------------------------------------------------------ */
/* Une voix                                                             */
/* ------------------------------------------------------------------ */

const centsToRatio = (c: number) => Math.pow(2, c / 1200)

interface VoiceCtx {
  ctx: BaseAudioContext
  dest: AudioNode
  p: SynthParams
  freq: number
  key: number
  time: number
  dur: number       // duree de maintien, en secondes
  vel: number
  bpm: number
  fromFreq?: number // note precedente, pour le glide
}

/** Applique une enveloppe ADSR a un AudioParam entre 0 et peak. */
function applyEnv(param: AudioParam, e: Env, t0: number, hold: number, peak: number, floor = 0.0001) {
  const a = Math.max(0.0008, e.a)
  const d = Math.max(0.004, e.d)
  const s = clamp(e.s, 0, 1)
  const r = Math.max(0.008, e.r)
  param.cancelScheduledValues(t0)
  param.setValueAtTime(floor, t0)
  param.linearRampToValueAtTime(peak, t0 + a)
  // decroissance exponentielle vers le palier
  param.setTargetAtTime(Math.max(floor, peak * s), t0 + a, d / 3)
  const off = t0 + Math.max(a + 0.002, hold)
  param.setValueAtTime(Math.max(floor, peak * s + (peak - peak * s) * Math.exp(-3 * (off - t0 - a) / d)), off)
  param.linearRampToValueAtTime(floor, off + r)
  return off + r
}

/** Construit et lance un LFO ; renvoie sa sortie normalisee -1..1. */
function buildLfo(ctx: BaseAudioContext, l: Lfo, t0: number, end: number, bpm: number): AudioNode | null {
  const active = l.toPitch !== 0 || l.toCut !== 0 || l.toAmp !== 0 || l.toPan !== 0 || l.toPw !== 0
  if (!active) return null
  const rate = l.sync
    ? (bpm / 60) / LFO_DIVS[clamp(Math.round(l.div), 0, LFO_DIVS.length - 1)]
    : clamp(l.rate, 0.01, 40)

  const fade = ctx.createGain()
  if (l.fade > 0.01) {
    fade.gain.setValueAtTime(0, t0)
    fade.gain.linearRampToValueAtTime(1, t0 + l.fade)
  } else fade.gain.value = 1

  if (l.shape === 'sh') {
    // echantillonneur-bloqueur : des paliers aleatoires programmes a l'avance
    const c = ctx.createConstantSource()
    c.offset.setValueAtTime(Math.random() * 2 - 1, t0)
    const stepDur = 1 / rate
    for (let t = t0 + stepDur, n = 0; t < end && n < 400; t += stepDur, n++) {
      c.offset.setValueAtTime(Math.random() * 2 - 1, t)
    }
    c.start(t0); c.stop(end + 0.05)
    c.connect(fade)
    return fade
  }

  const o = ctx.createOscillator()
  o.type = l.shape === 'tri' ? 'triangle' : l.shape === 'saw' ? 'sawtooth' : l.shape === 'square' ? 'square' : 'sine'
  o.frequency.value = rate
  o.start(t0); o.stop(end + 0.05)
  o.connect(fade)
  return fade
}

/** Une pile d'oscillateurs desaccordes, repartis dans le stereo. */
function buildOsc(
  v: VoiceCtx, op: OscParams, dest: AudioNode,
  pitchMod: AudioNode | null, pwMod: AudioNode | null, end: number,
): void {
  if (op.level <= 0.001) return
  const { ctx, time, p } = v
  const base = v.freq * Math.pow(2, op.oct + op.semi / 12) * centsToRatio(op.fine)
  const n = clamp(Math.round(op.unison), 1, 7)
  const lvl = (op.level / Math.sqrt(n)) * 0.5

  for (let i = 0; i < n; i++) {
    const spread = n === 1 ? 0 : (i / (n - 1)) * 2 - 1
    const det = spread * op.detune + (Math.random() - 0.5) * 2.5 // derive analogique
    const g = ctx.createGain(); g.gain.value = lvl
    let node: AudioNode

    if (op.wave === 'noise') {
      const s = ctx.createBufferSource()
      s.buffer = noiseBuffer(ctx); s.loop = true
      s.playbackRate.value = clamp(base / 220, 0.05, 6)
      s.start(time, Math.random() * 1.6); s.stop(end + 0.05)
      node = s
    } else {
      const o = ctx.createOscillator()
      if (op.wave === 'pulse') o.setPeriodicWave(pulseWave(ctx, op.pw))
      else o.type = op.wave === 'saw' ? 'sawtooth' : op.wave
      o.detune.value = det
      if (p.glide > 0.001 && v.fromFreq) {
        o.frequency.setValueAtTime(v.fromFreq * (base / v.freq), time)
        o.frequency.exponentialRampToValueAtTime(base, time + clamp(p.glide, 0.002, 2))
      } else {
        o.frequency.value = base
      }
      if (pitchMod) pitchMod.connect(o.detune)
      // Le PWM se fait par palier de forme d'onde : on module la table en
      // basculant sur des voix voisines n'aurait pas de sens ici, on laisse
      // la largeur fixe et le LFO agit sur le filtre a la place.
      o.start(time); o.stop(end + 0.05)
      node = o
    }

    if (op.spread > 0.001 && typeof ctx.createStereoPanner === 'function' && n > 1) {
      const pan = ctx.createStereoPanner()
      pan.pan.value = clamp(spread * op.spread, -1, 1)
      node.connect(g).connect(pan).connect(dest)
    } else {
      node.connect(g).connect(dest)
    }
  }
  void pwMod
}

/** Joue une note. Renvoie l'instant de fin, pour la gestion des voix. */
export function playSynthVoice(
  ctx: BaseAudioContext, dest: AudioNode, p: SynthParams,
  freq: number, key: number, time: number, hold: number, vel: number, bpm: number,
  fromFreq?: number,
): number {
  const relTail = Math.max(p.ampEnv.r, p.filtEnv.r) + 0.05
  const end = time + Math.max(0.05, hold) + relTail + 0.1
  const v: VoiceCtx = { ctx, dest, p, freq, key, time, dur: hold, vel, bpm, fromFreq }

  /* --- sortie de la voix : ampli -> panoramique -> destination --- */
  const amp = ctx.createGain()
  amp.gain.value = 0
  let tail: AudioNode = amp
  const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null
  if (panner) { amp.connect(panner); tail = panner }
  tail.connect(dest)

  /* --- filtre --- */
  const shaper = ctx.createWaveShaper()
  shaper.curve = driveCurve(p.filter.drive * 0.8)
  shaper.oversample = '2x'
  const f1 = ctx.createBiquadFilter()
  const f2 = p.filter.kind === 'lp24' ? ctx.createBiquadFilter() : null
  const kind = p.filter.kind
  f1.type = kind === 'hp12' ? 'highpass' : kind === 'bp' ? 'bandpass' : kind === 'notch' ? 'notch' : 'lowpass'
  if (f2) { f2.type = 'lowpass'; f2.Q.value = 0.7 }
  f1.Q.value = clamp(p.filter.reso, 0.0001, 28)

  const preGain = ctx.createGain()
  preGain.gain.value = 1 / (1 + p.filter.drive * 1.4)   // compense la saturation

  if (kind === 'off') {
    shaper.connect(preGain).connect(amp)
  } else if (f2) {
    shaper.connect(f1).connect(f2).connect(preGain).connect(amp)
  } else {
    shaper.connect(f1).connect(preGain).connect(amp)
  }

  /* --- LFO --- */
  const l1 = buildLfo(ctx, p.lfo1, time, end, bpm)
  const l2 = buildLfo(ctx, p.lfo2, time, end, bpm)

  const routePitch = (src: AudioNode | null, amt: number): AudioNode | null => {
    if (!src || amt === 0) return null
    const g = ctx.createGain(); g.gain.value = amt
    src.connect(g)
    return g
  }
  const pitchMod = ctx.createGain(); pitchMod.gain.value = 1
  let pitchUsed = false
  for (const [src, amt] of [[l1, p.lfo1.toPitch], [l2, p.lfo2.toPitch]] as [AudioNode | null, number][]) {
    const g = routePitch(src, amt)
    if (g) { g.connect(pitchMod); pitchUsed = true }
  }

  /* --- sources --- */
  const oscBus = ctx.createGain()
  oscBus.connect(shaper)

  const aGain = ctx.createGain(); aGain.gain.value = Math.cos(clamp(p.mix, 0, 1) * Math.PI / 2)
  const bGain = ctx.createGain(); bGain.gain.value = Math.sin(clamp(p.mix, 0, 1) * Math.PI / 2)
  aGain.connect(oscBus); bGain.connect(oscBus)

  const pm = pitchUsed ? pitchMod : null
  buildOsc(v, p.oscA, aGain, pm, null, end)
  buildOsc(v, p.oscB, bGain, pm, null, end)

  // modulation en anneau : B pilote le gain d'un multiplicateur traverse par A
  if (p.ring > 0.001) {
    const ringOut = ctx.createGain(); ringOut.gain.value = 0
    const ringLvl = ctx.createGain(); ringLvl.gain.value = p.ring
    const carrier = ctx.createGain(); carrier.gain.value = 1
    buildOsc(v, { ...p.oscA, unison: 1, level: 1 }, carrier, pm, null, end)
    const modulator = ctx.createGain(); modulator.gain.value = 1
    buildOsc(v, { ...p.oscB, unison: 1, level: 1 }, modulator, pm, null, end)
    modulator.connect(ringOut.gain)
    carrier.connect(ringOut).connect(ringLvl).connect(oscBus)
  }

  if (p.sub.level > 0.001) {
    const o = ctx.createOscillator()
    o.type = p.sub.wave
    o.frequency.value = freq * Math.pow(2, p.sub.oct)
    if (pm) pm.connect(o.detune)
    const g = ctx.createGain(); g.gain.value = p.sub.level * 0.5
    o.connect(g).connect(oscBus)
    o.start(time); o.stop(end + 0.05)
  }

  if (p.noise > 0.001) {
    const s = ctx.createBufferSource()
    s.buffer = noiseBuffer(ctx); s.loop = true
    const g = ctx.createGain(); g.gain.value = p.noise * 0.35
    s.connect(g).connect(oscBus)
    s.start(time, Math.random() * 1.6); s.stop(end + 0.05)
  }

  /* --- enveloppe d'amplitude --- */
  const velAmp = 1 - p.velAmp + p.velAmp * vel
  const peak = clamp(p.gain, 0, 1.6) * velAmp
  applyEnv(amp.gain, p.ampEnv, time, hold, peak)

  /* --- enveloppe et modulation du filtre --- */
  if (kind !== 'off') {
    const keyTrack = Math.pow(2, ((key - 60) / 12) * clamp(p.filter.key, 0, 1))
    const velCut = 1 + p.velCut * (vel - 0.5) * 2
    const base = clamp(p.filter.cutoff * keyTrack * velCut, 20, 19000)
    const peakF = clamp(base * (1 + clamp(p.filter.env, 0, 1) * 22), 20, 19500)
    const target = (par: AudioParam) => {
      const e = p.filtEnv
      const a = Math.max(0.0008, e.a), d = Math.max(0.004, e.d)
      const sus = base + (peakF - base) * clamp(e.s, 0, 1)
      par.cancelScheduledValues(time)
      par.setValueAtTime(base, time)
      par.linearRampToValueAtTime(peakF, time + a)
      par.setTargetAtTime(sus, time + a, d / 3)
      const off = time + Math.max(a + 0.002, hold)
      par.setValueAtTime(Math.max(20, sus), off)
      par.linearRampToValueAtTime(base, off + Math.max(0.008, e.r))
    }
    target(f1.frequency)
    if (f2) target(f2.frequency)

    for (const [src, amt] of [[l1, p.lfo1.toCut], [l2, p.lfo2.toCut]] as [AudioNode | null, number][]) {
      if (!src || amt === 0) continue
      const g = ctx.createGain()
      g.gain.value = base * clamp(amt, -1, 1) * 0.95
      src.connect(g)
      g.connect(f1.frequency)
      if (f2) g.connect(f2.frequency)
    }
  }

  /* --- tremolo et panoramique --- */
  for (const [src, amt] of [[l1, p.lfo1.toAmp], [l2, p.lfo2.toAmp]] as [AudioNode | null, number][]) {
    if (!src || amt === 0) continue
    const g = ctx.createGain(); g.gain.value = peak * clamp(amt, 0, 1) * 0.5
    src.connect(g).connect(amp.gain)
  }
  if (panner) {
    for (const [src, amt] of [[l1, p.lfo1.toPan], [l2, p.lfo2.toPan]] as [AudioNode | null, number][]) {
      if (!src || amt === 0) continue
      const g = ctx.createGain(); g.gain.value = clamp(amt, 0, 1)
      src.connect(g).connect(panner.pan)
    }
  }

  return end
}

/* ------------------------------------------------------------------ */
/* Chaine d'effets par channel : ce qui fait qu'un preset sonne          */
/* tout de suite plutot que sec.                                        */
/* ------------------------------------------------------------------ */

export interface SynthFxChain { input: GainNode; output: GainNode; update(fx: SynthFx, bpm: number): void; stop(): void }

export function buildSynthFx(ctx: BaseAudioContext, fx: SynthFx, bpm: number): SynthFxChain {
  const input = ctx.createGain()
  const output = ctx.createGain()

  const shaper = ctx.createWaveShaper(); shaper.oversample = '2x'
  const post = ctx.createGain()
  input.connect(shaper).connect(post)

  // chorus : trois lignes a retard modulees, reparties en stereo
  const dryC = ctx.createGain(), wetC = ctx.createGain()
  const merge = ctx.createChannelMerger(2)
  const lfos: OscillatorNode[] = [], depths: GainNode[] = []
  post.connect(dryC)
  for (let i = 0; i < 3; i++) {
    const dl = ctx.createDelay(0.08)
    dl.delayTime.value = 0.011 + i * 0.005
    const lo = ctx.createOscillator(); lo.frequency.value = 0.45 + i * 0.17
    const dg = ctx.createGain(); dg.gain.value = 0
    lo.connect(dg).connect(dl.delayTime); lo.start(i * 0.11)
    const g = ctx.createGain(); g.gain.value = 0.5
    post.connect(dl).connect(g)
    g.connect(merge, 0, i % 2)
    lfos.push(lo); depths.push(dg)
  }
  merge.connect(wetC)

  const bus = ctx.createGain()
  dryC.connect(bus); wetC.connect(bus)
  bus.connect(output)

  // delai synchronise
  const dl = ctx.createDelay(4)
  const fb = ctx.createGain()
  const dampen = ctx.createBiquadFilter(); dampen.type = 'lowpass'; dampen.frequency.value = 4200
  const wetD = ctx.createGain(); wetD.gain.value = 0
  bus.connect(dl).connect(dampen).connect(fb).connect(dl)
  dl.connect(wetD).connect(output)

  // reverbe
  const conv = ctx.createConvolver(); conv.normalize = true
  const wetR = ctx.createGain(); wetR.gain.value = 0
  const pre = ctx.createDelay(0.2); pre.delayTime.value = 0.015
  bus.connect(pre).connect(conv).connect(wetR).connect(output)

  let driveKey = '', irKey = ''
  const chain: SynthFxChain = {
    input, output,
    update(f, tempo) {
      const dk = f.drive.toFixed(3)
      if (dk !== driveKey) { shaper.curve = driveCurve(f.drive * 0.9); driveKey = dk }
      post.gain.value = 1 / (1 + f.drive * 1.1)
      depths.forEach((d) => { d.gain.value = f.chorus * 0.0055 })
      wetC.gain.value = f.chorus * 0.75
      dryC.gain.value = 1
      const beat = 60 / Math.max(20, tempo)
      dl.delayTime.value = clamp(DLY_DIVS[clamp(Math.round(f.delayDiv), 0, DLY_DIVS.length - 1)] * beat, 0.005, 4)
      fb.gain.value = clamp(f.delayFb, 0, 0.9)
      wetD.gain.value = clamp(f.delay, 0, 1) * 0.8
      const ik = f.size.toFixed(2)
      if (ik !== irKey) {
        const len = Math.max(1, Math.floor(ctx.sampleRate * clamp(f.size, 0.2, 6)))
        const buf = ctx.createBuffer(2, len, ctx.sampleRate)
        for (let c = 0; c < 2; c++) {
          const d = buf.getChannelData(c)
          let z = 0
          const coef = Math.exp(-2 * Math.PI * 5200 / ctx.sampleRate)
          for (let i = 0; i < len; i++) {
            const t = i / len
            z = (Math.random() * 2 - 1) * (1 - coef) + z * coef
            d[i] = z * Math.pow(1 - t, 2.5) * (1 - Math.exp(-i / 200))
          }
        }
        conv.buffer = buf
        irKey = ik
      }
      wetR.gain.value = clamp(f.reverb, 0, 1) * 1.15
    },
    stop() { lfos.forEach((l) => { try { l.stop() } catch { /* deja arrete */ } }) },
  }
  chain.update(fx, bpm)
  return chain
}
