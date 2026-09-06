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
import { buildEq, defaultEq, eqAutoGain, type EqBand } from './eq'

export interface NcSettings {
  mode: 'tape' | 'free'
  speed: number     // 0.5 .. 2.0  (1 = original)
  pitch: number     // demi-tons, mode libre uniquement
  cut: number       // passe-haut, Hz
  eq: EqBand[]      // cinq bandes parametriques
  tilt: number      // dB, bascule spectrale grave <-> aigu
  autoTilt: boolean // la bascule suit la vitesse (anti-etouffement)
  exciter: number   // 0..1, harmoniques d'aigu reconstruites
  glue: number      // 0..1, compression de cohesion
  autoGain: boolean // compense le niveau ajoute par l'egaliseur
  drive: number     // 0..1
  width: number     // 0..2  (1 = inchange)
  rotate: number    // Hz, panoramique automatique facon "8D"
  wobble: number    // 0..1, pleurage de bande
  reverb: number    // 0..1, dosage
  size: number      // s, taille de la salle
  gain: number      // 0..2
}

export function defaultNc(): NcSettings {
  const eq = defaultEq()
  eq[0].g = 2.5   // un peu de grave
  eq[4].g = 2     // un peu d'air
  return {
    mode: 'tape', speed: 1.3, pitch: 0, cut: 30,
    eq, tilt: 0, autoTilt: true, exciter: 0.12, glue: 0.2, autoGain: true,
    drive: 0.08, width: 1.25, rotate: 0, wobble: 0.06,
    reverb: 0.22, size: 2.2, gain: 1,
  }
}

/** Fabrique un jeu de bandes a partir des cinq gains d'un preset. */
function eqOf(gains: number[], tweak?: Partial<EqBand>[]): EqBand[] {
  const bands = defaultEq()
  gains.forEach((g, i) => { if (bands[i]) bands[i].g = g })
  tweak?.forEach((t, i) => { if (bands[i] && t) Object.assign(bands[i], t) })
  return bands
}

/** Bascule spectrale automatique.
    Ralentir un morceau descend tout son spectre : il s'etouffe. Accelerer
    fait l'inverse et le rend criard. On compense dans le sens contraire,
    a peu pres a moitie — corriger a 100 % annulerait l'effet recherche. */
export function autoTiltOf(speed: number): number {
  return clamp(-12 * Math.log2(clamp(speed, 0.25, 4)) * 0.55, -7, 7)
}

export interface NcPreset { name: string; tag: string; s: Partial<NcSettings> }

export const NC_PRESETS: NcPreset[] = [
  { name: 'NIGHTCORE', tag: 'le classique, 1.30x', s: {
    mode: 'tape', speed: 1.3, eq: eqOf([2.5, -1.5, 0, 1, 3]), exciter: 0.14, glue: 0.22,
    reverb: 0.2, size: 1.8, width: 1.3, wobble: 0.05, rotate: 0, drive: 0.1 } },
  { name: 'NIGHTCORE DOUX', tag: 'a peine presse', s: {
    mode: 'tape', speed: 1.18, eq: eqOf([3, -1, 0, 0.5, 2]), exciter: 0.1, glue: 0.18,
    reverb: 0.26, size: 2.2, width: 1.2, wobble: 0.04, rotate: 0, drive: 0.06 } },
  { name: 'HYPER', tag: 'ca part en vrille', s: {
    mode: 'tape', speed: 1.5, eq: eqOf([1, -3, -1, 2, 4.5]), exciter: 0.2, glue: 0.3,
    reverb: 0.16, size: 1.4, width: 1.45, wobble: 0.1, rotate: 0, drive: 0.22 } },
  { name: 'RALENTI + REVERB', tag: 'slowed, 0.82x', s: {
    mode: 'tape', speed: 0.82, eq: eqOf([4.5, -3.5, 0, 2.5, 2]), exciter: 0.3, glue: 0.25,
    reverb: 0.5, size: 3.6, width: 1.35, wobble: 0.08, rotate: 0, drive: 0.05 } },
  { name: 'VAPORWAVE', tag: '0.72x et bande fatiguee', s: {
    mode: 'tape', speed: 0.72, eq: eqOf([5, -2, 1, 0, -3]), exciter: 0.05, glue: 0.35,
    reverb: 0.42, size: 4.2, width: 1.5, wobble: 0.3, rotate: 0, drive: 0.12 } },
  { name: '8D', tag: 'ca tourne autour de la tete', s: {
    mode: 'tape', speed: 1.25, eq: eqOf([3, -2, 0, 1.5, 2.5]), exciter: 0.16, glue: 0.2,
    reverb: 0.34, size: 2.8, width: 1.6, rotate: 0.22, wobble: 0.04, drive: 0.06 } },
  { name: 'CHIPMUNK', tag: 'aucune dignite', s: {
    mode: 'tape', speed: 1.75, eq: eqOf([0, -4, 2, 3, 5]), exciter: 0.25, glue: 0.4,
    reverb: 0.12, size: 1.2, width: 1.1, wobble: 0.12, rotate: 0, drive: 0.3 } },
  { name: 'RAPIDE, VOIX INTACTE', tag: 'mode libre', s: {
    mode: 'free', speed: 1.3, pitch: 0, eq: eqOf([2, -1.5, 1, 1.5, 2]), exciter: 0.18, glue: 0.2,
    reverb: 0.18, size: 1.8, width: 1.2, wobble: 0, rotate: 0, drive: 0.06 } },
  { name: 'GRAVE COLOSSAL', tag: 'pour les caissons', s: {
    mode: 'tape', speed: 1, eq: eqOf([8.5, -3, -1, 1, 2], [{ f: 85 }]), exciter: 0.2, glue: 0.4,
    reverb: 0.12, size: 1.6, width: 1.15, wobble: 0.02, rotate: 0, drive: 0.14, cut: 22 } },
  { name: 'CA RESPIRE', tag: 'contre le son etouffe', s: {
    mode: 'tape', speed: 1, eq: eqOf([2.5, -6, -1.5, 3, 5]), exciter: 0.42, glue: 0.15,
    reverb: 0.16, size: 2, width: 1.3, wobble: 0.02, rotate: 0, drive: 0.05 } },
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

  // Egaliseur parametrique : le coeur du reglage de couleur
  const eq = buildEq(ctx, s.eq)

  // Bascule spectrale : deux plateaux opposes autour de 700 Hz. Une seule
  // commande pour dire « plus clair » ou « plus sombre » sans toucher a l'EQ.
  const tiltLo = ctx.createBiquadFilter(); tiltLo.type = 'lowshelf'; tiltLo.frequency.value = 700
  const tiltHi = ctx.createBiquadFilter(); tiltHi.type = 'highshelf'; tiltHi.frequency.value = 700

  const shaper = ctx.createWaveShaper(); shaper.oversample = '2x'

  // Exciter : un morceau ralenti n'a plus d'aigus a remonter — un plateau
  // ne fait que grossir du silence. On en fabrique donc : on prend le haut
  // du medium, on le sature pour creer ses harmoniques, puis on ne garde
  // que ce qui est apparu au-dessus. L'ordre compte — filtrer d'abord tout
  // en haut ne laisserait rien a distordre.
  const exIn = ctx.createGain()
  const exHp = ctx.createBiquadFilter(); exHp.type = 'highpass'; exHp.frequency.value = 1200; exHp.Q.value = 0.6
  const exShape = ctx.createWaveShaper(); exShape.oversample = '4x'; exShape.curve = driveCurve(0.9, 0.4)
  const exPost = ctx.createBiquadFilter(); exPost.type = 'highpass'; exPost.frequency.value = 3000; exPost.Q.value = 0.6
  const exGain = ctx.createGain(); exGain.gain.value = 0

  // Compression de cohesion : elle tient l'ensemble quand on pousse le grave
  const glue = ctx.createDynamicsCompressor()
  glue.knee.value = 22; glue.attack.value = 0.02; glue.release.value = 0.22

  // Compensation de niveau et limiteur de sortie
  const trim = ctx.createGain()
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1.2; limiter.knee.value = 0; limiter.ratio.value = 20
  limiter.attack.value = 0.002; limiter.release.value = 0.14

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

  input.connect(flutter).connect(hp)
  hp.connect(eq.input)
  eq.output.connect(tiltLo).connect(tiltHi)
  tiltHi.connect(exIn)
  exIn.connect(exHp).connect(exShape).connect(exPost).connect(exGain).connect(shaper)
  exIn.connect(shaper)
  shaper.connect(glue).connect(split)
  const afterWidth: AudioNode = rot ? (merge.connect(rot), rot) : merge
  const sum = ctx.createGain()
  afterWidth.connect(dry).connect(sum)
  afterWidth.connect(preDelay).connect(conv).connect(wet).connect(sum)
  sum.connect(trim).connect(limiter).connect(output)

  let irKey = '', driveKey = ''
  const chain: NcChain = {
    input, output,
    update(v) {
      hp.frequency.value = clamp(v.cut, 15, 800)
      eq.update(v.eq)
      const tilt = clamp(v.autoTilt ? autoTiltOf(v.speed) + v.tilt : v.tilt, -12, 12)
      tiltLo.gain.value = -tilt
      tiltHi.gain.value = tilt
      exGain.gain.value = clamp(v.exciter, 0, 1) * 0.55
      // Un seuil qui descend et un ratio qui monte : une seule commande
      // pour « plus serre », comme sur une tranche de console.
      const gl = clamp(v.glue, 0, 1)
      glue.threshold.value = -6 - gl * 24
      glue.ratio.value = 1.5 + gl * 8
      // La compensation prend l'EQ ET la bascule en compte
      const tiltComp = -Math.abs(tilt) * 0.18
      trim.gain.value = v.autoGain
        ? Math.pow(10, clamp(eqAutoGain(v.eq) + tiltComp - v.exciter * 1.6, -18, 12) / 20)
        : 1
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

  // Le limiteur vit desormais dans la chaine : le rendu et l'ecoute
  // passent exactement par le meme traitement.
  chain.output.connect(ctx.destination)

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
