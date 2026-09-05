/* ============================================================
   DJ ViDAW — MOTEUR NIGHTCORIFICATION
   Le nightcore, techniquement, c'est une bande magnetique qu'on
   accelere : la hauteur monte avec la vitesse. Le "slowed + reverb"
   est exactement le meme effet dans l'autre sens.
   Le mode RUBAN reproduit ca exactement (aucune degradation).
   Le mode LIBRE decorrele vitesse et hauteur par recouvrement de
   grains — utile, mais ca gresille un peu, c'est le prix.
   ============================================================ */

import { clamp, midiToRate } from '../core/state'
import { makeIR } from './fx'
import { driveCurve, type F32 } from './voices'

export interface NcSettings {
  mode: 'tape' | 'free'
  speed: number     // 0.5 .. 2.0  (1 = original)
  pitch: number     // demi-tons, mode libre uniquement
  cut: number       // passe-haut, Hz
  bass: number      // dB, plateau grave
  air: number       // dB, plateau aigu
  drive: number     // 0..1
  width: number     // 0..2  (1 = inchange)
  rotate: number    // Hz, panoramique automatique facon "8D"
  wobble: number    // 0..1, pleurage de bande
  reverb: number    // 0..1, dosage
  size: number      // s, taille de la salle
  gain: number      // 0..2
}

export function defaultNc(): NcSettings {
  return {
    mode: 'tape', speed: 1.3, pitch: 0, cut: 30, bass: 2.5, air: 2,
    drive: 0.08, width: 1.25, rotate: 0, wobble: 0.06,
    reverb: 0.22, size: 2.2, gain: 1,
  }
}

export interface NcPreset { name: string; tag: string; s: Partial<NcSettings> }

export const NC_PRESETS: NcPreset[] = [
  { name: 'NIGHTCORE', tag: 'le classique, 1.30x', s: {
    mode: 'tape', speed: 1.3, bass: 2.5, air: 3, reverb: 0.2, size: 1.8, width: 1.3, wobble: 0.05, rotate: 0, drive: 0.1 } },
  { name: 'NIGHTCORE DOUX', tag: 'a peine presse', s: {
    mode: 'tape', speed: 1.18, bass: 3, air: 2, reverb: 0.26, size: 2.2, width: 1.2, wobble: 0.04, rotate: 0, drive: 0.06 } },
  { name: 'HYPER', tag: 'ca part en vrille', s: {
    mode: 'tape', speed: 1.5, bass: 1, air: 4.5, reverb: 0.16, size: 1.4, width: 1.45, wobble: 0.1, rotate: 0, drive: 0.22 } },
  { name: 'RALENTI + REVERB', tag: 'slowed, 0.82x', s: {
    mode: 'tape', speed: 0.82, bass: 4.5, air: -1, reverb: 0.5, size: 3.6, width: 1.35, wobble: 0.08, rotate: 0, drive: 0.05 } },
  { name: 'VAPORWAVE', tag: '0.72x et bande fatiguee', s: {
    mode: 'tape', speed: 0.72, bass: 5, air: -3, reverb: 0.42, size: 4.2, width: 1.5, wobble: 0.3, rotate: 0, drive: 0.12 } },
  { name: '8D', tag: 'ca tourne autour de la tete', s: {
    mode: 'tape', speed: 1.25, bass: 3, air: 2, reverb: 0.34, size: 2.8, width: 1.6, rotate: 0.22, wobble: 0.04, drive: 0.06 } },
  { name: 'CHIPMUNK', tag: 'aucune dignite', s: {
    mode: 'tape', speed: 1.75, bass: 0, air: 5, reverb: 0.12, size: 1.2, width: 1.1, wobble: 0.12, rotate: 0, drive: 0.3 } },
  { name: 'RAPIDE, VOIX INTACTE', tag: 'mode libre', s: {
    mode: 'free', speed: 1.3, pitch: 0, bass: 2, air: 2, reverb: 0.18, size: 1.8, width: 1.2, wobble: 0, rotate: 0, drive: 0.06 } },
]

/* ------------------------------------------------------------------ */
/* La chaine, construite a l'identique en direct et hors-ligne          */
/* ------------------------------------------------------------------ */

export interface NcChain {
  input: AudioNode
  output: AudioNode
  update(s: NcSettings): void
  stop(): void
}

export function buildNcChain(ctx: BaseAudioContext, s: NcSettings): NcChain {
  const input = ctx.createGain()
  const output = ctx.createGain()

  // Pleurage de bande : un retard tres court module par deux LFO desaccordes
  const flutter = ctx.createDelay(0.05)
  flutter.delayTime.value = 0.006
  const fl1 = ctx.createOscillator(), fl2 = ctx.createOscillator()
  const fd1 = ctx.createGain(), fd2 = ctx.createGain()
  fl1.frequency.value = 5.7; fl2.frequency.value = 0.7
  fl1.connect(fd1).connect(flutter.delayTime)
  fl2.connect(fd2).connect(flutter.delayTime)
  fl1.start(); fl2.start()

  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'
  const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 180
  const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 6500
  const shaper = ctx.createWaveShaper(); shaper.oversample = '2x'

  // Elargisseur mi/lateral : on reconstruit L/R a partir de M et S
  const split = ctx.createChannelSplitter(2)
  const merge = ctx.createChannelMerger(2)
  const mid = ctx.createGain(), side = ctx.createGain()
  const negR = ctx.createGain(); negR.gain.value = -1
  const negS = ctx.createGain(); negS.gain.value = -1
  mid.gain.value = 0.5; side.gain.value = 0.5
  split.connect(mid, 0); split.connect(mid, 1)          // M = (L+R)/2
  split.connect(side, 0)
  split.connect(negR, 1); negR.connect(side)            // S = (L-R)/2
  const widthG = ctx.createGain()
  side.connect(widthG)
  mid.connect(merge, 0, 0); widthG.connect(merge, 0, 0) // L = M + S*w
  mid.connect(merge, 0, 1)
  widthG.connect(negS); negS.connect(merge, 0, 1)       // R = M - S*w

  // Panoramique automatique
  const rot = ctx.createStereoPanner ? ctx.createStereoPanner() : null
  const rotLfo = ctx.createOscillator()
  const rotDepth = ctx.createGain()
  rotLfo.type = 'sine'
  if (rot) rotLfo.connect(rotDepth).connect(rot.pan)
  rotLfo.start()

  const dry = ctx.createGain(), wet = ctx.createGain()
  const conv = ctx.createConvolver(); conv.normalize = true
  const preDelay = ctx.createDelay(0.2); preDelay.delayTime.value = 0.018

  input.connect(flutter).connect(hp).connect(low).connect(high).connect(shaper).connect(split)
  const afterWidth: AudioNode = rot ? (merge.connect(rot), rot) : merge
  afterWidth.connect(dry).connect(output)
  afterWidth.connect(preDelay).connect(conv).connect(wet).connect(output)

  let irKey = '', driveKey = ''
  const chain: NcChain = {
    input, output,
    update(v) {
      hp.frequency.value = clamp(v.cut, 15, 800)
      low.gain.value = clamp(v.bass, -18, 18)
      high.gain.value = clamp(v.air, -18, 18)
      const dk = v.drive.toFixed(3)
      if (dk !== driveKey) { shaper.curve = driveCurve(v.drive * 0.55); driveKey = dk }
      widthG.gain.value = clamp(v.width, 0, 2.5) * 0.5
      if (rot) rotDepth.gain.value = v.rotate > 0.01 ? 0.92 : 0
      rotLfo.frequency.value = clamp(v.rotate, 0.01, 8)
      const ik = `${v.size.toFixed(2)}`
      if (ik !== irKey) { conv.buffer = makeIR(ctx, v.size, 7000); irKey = ik }
      wet.gain.value = clamp(v.reverb, 0, 1) * 1.25
      dry.gain.value = 1 - clamp(v.reverb, 0, 1) * 0.32
      fd1.gain.value = v.wobble * 0.0022
      fd2.gain.value = v.wobble * 0.0045
      output.gain.value = clamp(v.gain, 0, 2.5)
    },
    stop() {
      for (const o of [fl1, fl2, rotLfo]) { try { o.stop() } catch { /* deja arrete */ } }
    },
  }
  chain.update(s)
  return chain
}

/* ------------------------------------------------------------------ */
/* Vitesse et hauteur                                                  */
/* ------------------------------------------------------------------ */

/** Facteur de lecture (donc de hauteur) et facteur d'etirement a appliquer
    au tampon avant lecture pour obtenir la vitesse demandee. */
export function rates(s: NcSettings): { playback: number; stretch: number } {
  const speed = clamp(s.speed, 0.25, 4)
  if (s.mode === 'tape') return { playback: speed, stretch: 1 }
  const playback = midiToRate(clamp(s.pitch, -24, 24))
  return { playback, stretch: playback / speed }
}

export const semitonesOf = (speed: number) => 12 * Math.log2(clamp(speed, 0.01, 8))

/** Etirement temporel par recouvrement de grains fenetres (Hann).
    Simple, rapide, et assez sale pour le genre. */
export function timeStretch(ctx: BaseAudioContext, buf: AudioBuffer, k: number): AudioBuffer {
  if (Math.abs(k - 1) < 0.002) return buf
  const rate = buf.sampleRate
  const grain = Math.max(256, Math.round(rate * 0.075))     // ~75 ms
  const half = grain >> 1
  const hopOut = half                                        // recouvrement 50 %
  const hopIn = hopOut / k
  const outLen = Math.max(1, Math.round(buf.length * k) + grain)
  const out = ctx.createBuffer(buf.numberOfChannels, outLen, rate)

  const win: F32 = new Float32Array(grain)
  for (let i = 0; i < grain; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (grain - 1))

  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c)
    const dst = out.getChannelData(c)
    let posIn = 0
    for (let posOut = 0; posOut + grain < outLen; posOut += hopOut) {
      const start = Math.floor(posIn)
      const frac = posIn - start
      for (let i = 0; i < grain; i++) {
        const j = start + i
        if (j + 1 >= src.length) break
        // interpolation lineaire : hopIn n'est pas entier
        const v = src[j] + (src[j + 1] - src[j]) * frac
        dst[posOut + i] += v * win[i]
      }
      posIn += hopIn
      if (posIn >= src.length) break
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Rendu hors-ligne                                                    */
/* ------------------------------------------------------------------ */

export async function renderNc(
  src: AudioBuffer, s: NcSettings, onProgress?: (p: number) => void,
): Promise<AudioBuffer> {
  const { playback, stretch } = rates(s)
  onProgress?.(0.05)

  const OfflineCtor: typeof OfflineAudioContext =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext

  // L'etirement se fait sur un contexte jetable : il ne sert qu'a allouer.
  let source = src
  if (Math.abs(stretch - 1) > 0.002) {
    const tmp = new OfflineCtor(src.numberOfChannels, 1, src.sampleRate)
    source = timeStretch(tmp, src, stretch)
    onProgress?.(0.35)
  }

  const tail = 0.35 + s.size * 1.15
  const seconds = source.duration / playback + tail
  const ctx = new OfflineCtor(2, Math.ceil(seconds * src.sampleRate), src.sampleRate)

  const node = ctx.createBufferSource()
  node.buffer = source
  node.playbackRate.value = playback
  const chain = buildNcChain(ctx, s)
  node.connect(chain.input)

  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1.2; limiter.knee.value = 0; limiter.ratio.value = 20
  limiter.attack.value = 0.002; limiter.release.value = 0.14
  chain.output.connect(limiter).connect(ctx.destination)

  node.start(0)
  onProgress?.(0.45)
  const out = await ctx.startRendering()
  chain.stop()
  onProgress?.(1)
  return out
}

/* ------------------------------------------------------------------ */
/* Lecture en direct                                                   */
/* ------------------------------------------------------------------ */

export class NcPlayer {
  private node: AudioBufferSourceNode | null = null
  private chain: NcChain | null = null
  private startedAt = 0
  private offset = 0
  private stretched: AudioBuffer | null = null
  private stretchKey = ''
  playing = false
  loop: [number, number] | null = null
  onEnd: (() => void) | null = null

  /** Noeud additionnel branche en parallele (analyseur du bandeau). */
  tap: AudioNode | null = null

  constructor(private ctx: AudioContext, public buffer: AudioBuffer, public settings: NcSettings) {}

  /** Tampon reellement lu : etire seulement en mode libre. */
  private material(): AudioBuffer {
    const { stretch } = rates(this.settings)
    if (Math.abs(stretch - 1) < 0.002) return this.buffer
    const key = stretch.toFixed(4)
    if (key !== this.stretchKey || !this.stretched) {
      this.stretched = timeStretch(this.ctx, this.buffer, stretch)
      this.stretchKey = key
    }
    return this.stretched
  }

  /** Duree du resultat, en secondes. */
  get duration(): number {
    const { playback } = rates(this.settings)
    return this.material().duration / playback
  }

  /** Position de lecture, en fraction du morceau. */
  get position(): number {
    if (!this.playing) return this.offset
    const { playback } = rates(this.settings)
    const mat = this.material().duration
    const t = this.offset * mat + (this.ctx.currentTime - this.startedAt) * playback
    return mat > 0 ? clamp(t / mat, 0, 1) : 0
  }

  play(from?: number) {
    this.stop(true)
    const mat = this.material()
    const { playback } = rates(this.settings)
    const chain = buildNcChain(this.ctx, this.settings)
    const node = this.ctx.createBufferSource()
    node.buffer = mat
    node.playbackRate.value = playback

    const a = this.loop ? this.loop[0] : 0
    const b = this.loop ? this.loop[1] : 1
    this.offset = clamp(from ?? this.offset, a, b)

    if (this.loop) {
      node.loop = true
      node.loopStart = a * mat.duration
      node.loopEnd = b * mat.duration
    }
    node.connect(chain.input)
    chain.output.connect(this.ctx.destination)
    if (this.tap) chain.output.connect(this.tap)
    node.onended = () => { if (this.playing && !node.loop) { this.playing = false; this.offset = 0; this.onEnd?.() } }
    node.start(0, this.offset * mat.duration)

    this.node = node
    this.chain = chain
    this.startedAt = this.ctx.currentTime
    this.playing = true
  }

  stop(keepOffset = false) {
    if (this.node) {
      if (!keepOffset) this.offset = 0
      else this.offset = this.position
      try { this.node.stop() } catch { /* deja arrete */ }
      this.node.disconnect()
      this.node = null
    }
    this.chain?.stop()
    this.chain?.output.disconnect()
    this.chain = null
    this.playing = false
  }

  /** Applique les reglages. Les changements de vitesse en mode ruban sont
      immediats ; en mode libre il faut re-etirer, donc on relance. */
  apply(next: NcSettings) {
    const before = rates(this.settings)
    this.settings = next
    const after = rates(next)
    this.chain?.update(next)
    if (!this.playing || !this.node) return
    if (Math.abs(before.stretch - after.stretch) > 0.002) { this.play(this.position); return }
    if (Math.abs(before.playback - after.playback) > 0.0005) {
      // on recale l'origine pour que la position reste juste
      this.offset = this.position
      this.startedAt = this.ctx.currentTime
      this.node.playbackRate.value = after.playback
    }
  }

  dispose() { this.stop(); this.stretched = null }
}
