/* ============================================================
   DJ ViDAW — SYNTHESE DES VOIX
   Tout est genere a la volee : zero fichier audio embarque.
   Chaque fonction sait jouer aussi bien dans un AudioContext live
   que dans un OfflineAudioContext (export WAV) — c'est ce qui permet
   au bounce d'etre bit-a-bit identique a ce qu'on entend.
   ============================================================ */

import type { Channel, DrumParams, SamplerParams, Note } from '../core/state'
import { midiToRate, clamp } from '../core/state'
import { playSynthVoice, type VoiceHandle } from './synth'

const ROOT = 60 // C5 dans notre convention

/* --- Buffers de bruit mis en cache par contexte -------------------- */
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>()
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx)
  if (b) return b
  b = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 2), ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  noiseCache.set(ctx, b)
  return b
}

/* --- Courbe de saturation ----------------------------------------- */
function newF32(n: number) { return new Float32Array(n) }
/** Alias insensible a la version de TypeScript (Float32Array est generique depuis 5.7). */
export type F32 = ReturnType<typeof newF32>

const shapeCache = new Map<string, F32>()
export function driveCurve(amount: number, fold = 0): F32 {
  const key = `${amount.toFixed(2)}|${fold.toFixed(2)}`
  const hit = shapeCache.get(key)
  if (hit) return hit
  const n = 2048
  const c = new Float32Array(n)
  const k = amount * 40 + 0.001
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    let y = Math.tanh(x * (1 + k)) / Math.tanh(1 + k)
    if (fold > 0) {
      const f = Math.sin(x * (1 + k * fold) * Math.PI * 0.5)
      y = y * (1 - fold) + f * fold
    }
    c[i] = y
  }
  shapeCache.set(key, c)
  return c
}

/* ------------------------------------------------------------------ */
/* PERCUSSIONS SYNTHETIQUES                                            */
/* ------------------------------------------------------------------ */

export function playDrum(
  ctx: BaseAudioContext, dest: AudioNode, d: DrumParams,
  time: number, vel: number, pitchOffset: number,
): void {
  const out = ctx.createGain()
  out.gain.value = vel
  const sat = ctx.createWaveShaper()
  sat.curve = driveCurve(d.drive)
  sat.oversample = '2x'
  out.connect(sat).connect(dest)

  const semis = d.tune + pitchOffset
  const rate = midiToRate(semis)
  const dec = Math.max(0.01, d.decay)
  const t = time

  const tone = (freq: number, endFreq: number, dur: number, gain: number, type: OscillatorType = 'sine') => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
    o.connect(g).connect(out)
    o.start(t); o.stop(t + dur + 0.05)
  }

  const noise = (dur: number, gain: number, filter: 'hp' | 'bp' | 'lp', freq: number, q = 1) => {
    const s = ctx.createBufferSource()
    s.buffer = noiseBuffer(ctx)
    s.playbackRate.value = 1
    s.loop = true
    const f = ctx.createBiquadFilter()
    f.type = filter === 'hp' ? 'highpass' : filter === 'bp' ? 'bandpass' : 'lowpass'
    f.frequency.value = clamp(freq, 30, 20000)
    f.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.001)
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
    s.connect(f).connect(g).connect(out)
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05)
  }

  switch (d.kind) {
    case 'kick': {
      const f0 = 150 * rate * (0.6 + d.tone)
      tone(f0, 34 * rate, dec, 1.0)
      if (d.snap > 0) noise(0.012 + d.snap * 0.02, d.snap * 0.5, 'hp', 1200, 0.7)
      break
    }
    case 'snare': {
      tone(190 * rate, 110 * rate, dec * 0.5, 0.55 - d.tone * 0.2)
      tone(285 * rate, 170 * rate, dec * 0.4, 0.3)
      noise(dec, 0.5 + d.snap * 0.4, 'hp', 900 + d.tone * 4000, 0.8)
      break
    }
    case 'clap': {
      for (let i = 0; i < 4; i++) {
        const off = i * (0.008 + (1 - d.snap) * 0.012)
        const s = ctx.createBufferSource()
        s.buffer = noiseBuffer(ctx); s.loop = true
        const f = ctx.createBiquadFilter()
        f.type = 'bandpass'; f.frequency.value = (900 + d.tone * 1600) * rate; f.Q.value = 1.4
        const g = ctx.createGain()
        const tt = t + off
        const dd = i === 3 ? dec : 0.028
        g.gain.setValueAtTime(0, tt)
        g.gain.linearRampToValueAtTime(i === 3 ? 0.75 : 0.5, tt + 0.001)
        g.gain.exponentialRampToValueAtTime(0.0008, tt + dd)
        s.connect(f).connect(g).connect(out)
        s.start(tt, Math.random()); s.stop(tt + dd + 0.05)
      }
      break
    }
    case 'hat':
    case 'ohat': {
      const dur = d.kind === 'hat' ? dec * 0.5 : dec
      const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21]
      const base = 40 * rate * (0.5 + d.tone)
      const mix = ctx.createGain(); mix.gain.value = 0.12
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'; hp.frequency.value = 5000 + d.tone * 5000
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.9, t + 0.0008)
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur)
      for (const r of ratios) {
        const o = ctx.createOscillator()
        o.type = 'square'; o.frequency.value = base * r
        o.connect(mix); o.start(t); o.stop(t + dur + 0.05)
      }
      noise(dur, 0.25 * d.snap, 'hp', 8000)
      mix.connect(hp).connect(g).connect(out)
      break
    }
    case 'tom': {
      tone(180 * rate, 70 * rate, dec, 0.9)
      noise(0.02, d.snap * 0.2, 'bp', 400 * rate, 1)
      break
    }
    case 'rim': {
      tone(1700 * rate, 1400 * rate, 0.03, 0.5, 'square')
      tone(460 * rate, 400 * rate, 0.03, 0.4, 'triangle')
      noise(0.02, 0.3 * d.snap, 'hp', 3000)
      break
    }
    case 'cowbell': {
      tone(540 * rate, 540 * rate, dec, 0.35, 'square')
      tone(800 * rate, 800 * rate, dec, 0.3, 'square')
      break
    }
    case 'crash': {
      const ratios = [2, 3.1, 4.4, 5.9, 7.4, 9.1, 11.3]
      const mix = ctx.createGain(); mix.gain.value = 0.08
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'; hp.frequency.value = 3000 + d.tone * 3000
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.8, t + 0.004)
      g.gain.exponentialRampToValueAtTime(0.0008, t + dec)
      for (const r of ratios) {
        const o = ctx.createOscillator()
        o.type = 'square'; o.frequency.value = 90 * rate * r
        o.connect(mix); o.start(t); o.stop(t + dec + 0.05)
      }
      noise(dec, 0.35, 'hp', 6000)
      mix.connect(hp).connect(g).connect(out)
      break
    }
    case 'zap': {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(2400 * rate, t)
      o.frequency.exponentialRampToValueAtTime(80 * rate, t + dec)
      g.gain.setValueAtTime(0.7, t)
      g.gain.exponentialRampToValueAtTime(0.0008, t + dec)
      o.connect(g).connect(out)
      o.start(t); o.stop(t + dec + 0.05)
      break
    }
  }
}

/* ------------------------------------------------------------------ */
/* SAMPLER                                                             */
/* ------------------------------------------------------------------ */

export interface SampleBank { get(id: string): AudioBuffer | undefined }

export function playSample(
  ctx: BaseAudioContext, dest: AudioNode, sp: SamplerParams, bank: SampleBank,
  note: Note, time: number, vel: number, pitchOffset: number, bpm: number, stepDur: number,
): AudioBufferSourceNode | null {
  if (!sp.sampleId) return null
  const buf = bank.get(sp.sampleId)
  if (!buf) return null

  const src = ctx.createBufferSource()
  const play = sp.reverse ? reversed(ctx, buf, sp.sampleId) : buf
  src.buffer = play

  let semis = (note.key - sp.rootKey) + pitchOffset
  let rate = midiToRate(semis)
  if (sp.stretch && sp.bpmOrigin > 0) rate *= bpm / sp.bpmOrigin

  src.playbackRate.value = rate

  // Fenetre : soit start/end globaux, soit une slice
  let a = clamp(Math.min(sp.start, sp.end), 0, 1)
  let b = clamp(Math.max(sp.start, sp.end), 0, 1)
  if (note.slice >= 0 && sp.slices.length) {
    const pts = [0, ...sp.slices, 1].sort((x, y) => x - y)
    const i = clamp(note.slice, 0, pts.length - 2)
    a = pts[i]; b = pts[i + 1]
  }
  if (sp.reverse) { const na = 1 - b, nb = 1 - a; a = na; b = nb }

  const dur = buf.duration
  const offset = a * dur
  const window = Math.max(0.005, (b - a) * dur)

  const g = ctx.createGain()
  const atk = Math.max(0.0005, sp.attack)
  const rel = Math.max(0.002, sp.release)
  const noteDur = Math.max(0.02, note.len * stepDur)
  const audible = sp.loop ? noteDur : Math.min(window / rate, noteDur + rel)

  g.gain.setValueAtTime(0, time)
  g.gain.linearRampToValueAtTime(vel, time + atk)
  g.gain.setValueAtTime(vel, Math.max(time + atk, time + audible - rel))
  g.gain.linearRampToValueAtTime(0.0001, time + audible)

  if (sp.loop) { src.loop = true; src.loopStart = offset; src.loopEnd = offset + window }
  src.connect(g).connect(dest)
  src.start(time, offset, sp.loop ? undefined : window)
  src.stop(time + audible + 0.02)
  return src
}

const revCache = new Map<string, AudioBuffer>()
function reversed(ctx: BaseAudioContext, buf: AudioBuffer, id: string): AudioBuffer {
  const key = `${id}@${ctx.sampleRate}`
  const hit = revCache.get(key)
  if (hit && hit.length === buf.length) return hit
  const r = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const s = buf.getChannelData(c), d = r.getChannelData(c)
    for (let i = 0, n = buf.length; i < n; i++) d[i] = s[n - 1 - i]
  }
  revCache.set(key, r)
  return r
}
export function clearReverseCache() { revCache.clear() }

/* ------------------------------------------------------------------ */
/* Aiguillage                                                          */
/* ------------------------------------------------------------------ */

/** Declenche une note sur un channel.
    Renvoie une poignee quand la voix sait etre relachee (synthe) : c'est
    ce qui permet a une touche maintenue de s'arreter au relachement
    plutot qu'a une duree fixe. Les percussions sont des one-shots. */
export function triggerNote(
  ctx: BaseAudioContext, dest: AudioNode, ch: Channel, note: Note,
  time: number, bank: SampleBank, bpm: number, stepDur: number,
): VoiceHandle | null {
  const vel = clamp(note.vel, 0, 1)
  if (ch.type === 'drum' && ch.drum) {
    playDrum(ctx, dest, ch.drum, time, vel, ch.pitch + (note.key - ROOT))
  } else if (ch.type === 'sampler' && ch.sampler) {
    playSample(ctx, dest, ch.sampler, bank, note, time, vel, ch.pitch, bpm, stepDur)
  } else if (ch.type === 'synth' && ch.synth) {
    const freq = 440 * Math.pow(2, (note.key + ch.pitch - 69) / 12)
    return playSynthVoice(ctx, dest, ch.synth, freq, note.key + ch.pitch, time,
      Math.max(0.03, note.len * stepDur), vel, bpm)
  }
  return null
}
