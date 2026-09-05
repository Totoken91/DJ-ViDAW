/* ============================================================
   DJ ViDAW — MODELE DE PROJET
   "Un DAW c'est juste un tableur qui fait du bruit" — DJ Viteau
   ============================================================ */

export type ChannelType = 'drum' | 'sampler' | 'synth'

export type DrumKind =
  | 'kick' | 'snare' | 'clap' | 'hat' | 'ohat'
  | 'tom' | 'rim' | 'cowbell' | 'crash' | 'zap'

export interface DrumParams {
  kind: DrumKind
  tune: number    // -24..+24 demi-tons
  decay: number   // 0.02..2 s
  tone: number    // 0..1 (couleur / filtre)
  snap: number    // 0..1 (transitoire / bruit)
  drive: number   // 0..1 saturation
}

export interface SamplerParams {
  sampleId: string | null
  start: number      // 0..1 offset normalisé
  end: number        // 0..1
  reverse: boolean
  loop: boolean
  attack: number     // s
  release: number    // s
  rootKey: number    // midi note qui joue le sample à vitesse 1
  slices: number[]   // positions normalisées des chops (triées)
  stretch: boolean   // si vrai le sample se cale au tempo (approximation par playbackRate)
  bpmOrigin: number  // bpm supposé du sample pour le stretch
}

export type OscShape = 'saw' | 'square' | 'sine' | 'triangle' | 'noise'

export interface SynthParams {
  osc1: OscShape
  osc2: OscShape
  mix: number        // 0..1 balance osc1/osc2
  detune: number     // cents
  unison: number     // 1..5 voix
  spread: number     // 0..1
  cutoff: number     // Hz
  reso: number       // 0..25
  envAmt: number     // 0..1 -> modulation du filtre
  attack: number
  decay: number
  sustain: number
  release: number
  fAttack: number
  fDecay: number
  glide: number
  sub: number        // 0..1 niveau sous-octave
}

export interface Channel {
  id: string
  name: string
  type: ChannelType
  color: string
  mute: boolean
  solo: boolean
  vol: number      // 0..1.4
  pan: number      // -1..1
  pitch: number    // demi-tons
  insert: number   // index de l'insert mixeur (0 = master)
  drum?: DrumParams
  sampler?: SamplerParams
  synth?: SynthParams
}

export interface Note {
  id: string
  ch: string     // channel id
  t: number      // position en pas de 1/16
  len: number    // longueur en pas
  key: number    // note midi (60 = C5 dans notre convention FL)
  vel: number    // 0..1
  slice: number  // -1 = pas de chop, sinon index de slice
}

export interface Pattern {
  id: string
  name: string
  color: string
  bars: number
  notes: Note[]
}

export interface Clip {
  id: string
  pat: string
  track: number
  start: number  // en pas de 1/16
  len: number    // en pas
}

export type FxType =
  | 'filter' | 'delay' | 'reverb' | 'crush' | 'dist'
  | 'chorus' | 'phaser' | 'eq3' | 'comp' | 'gate'

export interface FxSlot {
  id: string
  type: FxType
  on: boolean
  wet: number
  p: Record<string, number>
}

export interface Insert {
  id: number
  name: string
  vol: number
  pan: number
  mute: boolean
  fx: FxSlot[]
}

export interface SampleMeta {
  id: string
  name: string
  duration: number
  channels: number
  rate: number
}

export interface Project {
  name: string
  author: string
  bpm: number
  swing: number       // 0..0.5
  channels: Channel[]
  patterns: Pattern[]
  currentPattern: string
  clips: Clip[]
  inserts: Insert[]
  masterVol: number
  songLenBars: number
}

/* ------------------------------------------------------------------ */
/* Fabrique d'identifiants (assez unique pour un DAW de salon)          */
/* ------------------------------------------------------------------ */
let seq = 0
export const uid = (p = 'x') => `${p}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export const STEPS_PER_BAR = 16

export const DRUM_KINDS: DrumKind[] =
  ['kick', 'snare', 'clap', 'hat', 'ohat', 'tom', 'rim', 'cowbell', 'crash', 'zap']

export const CH_COLORS = [
  '#ff4fa3', '#ffd53d', '#4fe0ff', '#8cff4f', '#ff8a3d',
  '#c77dff', '#3dffcf', '#ff5f5f', '#9dff3d', '#5f9dff',
]

/* ------------------------------------------------------------------ */
/* Presets de paramètres                                               */
/* ------------------------------------------------------------------ */

export function defaultDrum(kind: DrumKind): DrumParams {
  const base: DrumParams = { kind, tune: 0, decay: 0.3, tone: 0.5, snap: 0.5, drive: 0.15 }
  switch (kind) {
    case 'kick': return { ...base, decay: 0.42, tone: 0.32, snap: 0.45, drive: 0.3 }
    case 'snare': return { ...base, decay: 0.22, tone: 0.55, snap: 0.7 }
    case 'clap': return { ...base, decay: 0.3, tone: 0.6, snap: 0.8 }
    case 'hat': return { ...base, decay: 0.06, tone: 0.85, snap: 0.4 }
    case 'ohat': return { ...base, decay: 0.34, tone: 0.8, snap: 0.35 }
    case 'tom': return { ...base, decay: 0.45, tone: 0.4, snap: 0.3, tune: -5 }
    case 'rim': return { ...base, decay: 0.08, tone: 0.7, snap: 0.9 }
    case 'cowbell': return { ...base, decay: 0.25, tone: 0.65, snap: 0.2 }
    case 'crash': return { ...base, decay: 1.4, tone: 0.9, snap: 0.2 }
    case 'zap': return { ...base, decay: 0.18, tone: 0.5, snap: 0.6, tune: 12 }
  }
}

export function defaultSampler(): SamplerParams {
  return {
    sampleId: null, start: 0, end: 1, reverse: false, loop: false,
    attack: 0.001, release: 0.02, rootKey: 60, slices: [],
    stretch: false, bpmOrigin: 120,
  }
}

export function defaultSynth(): SynthParams {
  return {
    osc1: 'saw', osc2: 'square', mix: 0.35, detune: 9, unison: 3, spread: 0.4,
    cutoff: 2400, reso: 6, envAmt: 0.55,
    attack: 0.006, decay: 0.28, sustain: 0.55, release: 0.22,
    fAttack: 0.004, fDecay: 0.32, glide: 0, sub: 0.25,
  }
}

export function makeChannel(type: ChannelType, name: string, i: number, kind?: DrumKind): Channel {
  const ch: Channel = {
    id: uid('ch'), name, type,
    color: CH_COLORS[i % CH_COLORS.length],
    mute: false, solo: false, vol: 0.85, pan: 0, pitch: 0, insert: 0,
  }
  if (type === 'drum') ch.drum = defaultDrum(kind ?? 'kick')
  if (type === 'sampler') ch.sampler = defaultSampler()
  if (type === 'synth') ch.synth = defaultSynth()
  return ch
}

export function makeInsert(id: number): Insert {
  return { id, name: id === 0 ? 'MASTER' : `INS ${id}`, vol: 0.8, pan: 0, mute: false, fx: [] }
}

export function makePattern(name: string, i: number): Pattern {
  return { id: uid('pat'), name, color: CH_COLORS[(i + 3) % CH_COLORS.length], bars: 1, notes: [] }
}

/* ------------------------------------------------------------------ */
/* Paramètres par défaut de chaque effet                               */
/* ------------------------------------------------------------------ */

export const FX_DEFS: Record<FxType, { label: string; params: Record<string, [number, number, number, string]> }> = {
  //                    param : [min, max, default, label]
  filter: { label: 'FILTRE FOU', params: {
    freq: [40, 18000, 1200, 'CUTOFF'], q: [0.3, 24, 4, 'RESO'], mode: [0, 2, 0, 'TYPE'], lfo: [0, 12, 0, 'WOBBLE'], depth: [0, 1, 0.5, 'PROF'] } },
  delay: { label: 'ECHO ECHO', params: {
    time: [0, 8, 3, 'SYNC'], fb: [0, 0.92, 0.4, 'FEEDBK'], tone: [200, 12000, 4000, 'TONE'], ping: [0, 1, 1, 'PING'] } },
  reverb: { label: 'GRANDE SALLE', params: {
    size: [0.1, 6, 2, 'TAILLE'], damp: [400, 16000, 5000, 'AMORTI'], pre: [0, 0.2, 0.01, 'PREDLY'] } },
  crush: { label: 'BITCRUSH 98', params: {
    bits: [1, 16, 6, 'BITS'], down: [1, 40, 6, 'SRATE'], noise: [0, 1, 0.05, 'GRAIN'] } },
  dist: { label: 'DISTO SALE', params: {
    drive: [1, 60, 12, 'DRIVE'], tone: [300, 14000, 6000, 'TONE'], fold: [0, 1, 0, 'FOLD'] } },
  chorus: { label: 'CHORUS DVD', params: {
    rate: [0.05, 8, 0.7, 'VITESSE'], depth: [0, 0.02, 0.006, 'PROF'], spread: [0, 1, 0.7, 'LARGE'] } },
  phaser: { label: 'PHASER PSY', params: {
    rate: [0.02, 8, 0.35, 'VITESSE'], depth: [0, 1, 0.7, 'PROF'], fb: [0, 0.85, 0.5, 'FEEDBK'] } },
  eq3: { label: 'EQ TROIS', params: {
    low: [-24, 18, 0, 'GRAVE'], mid: [-24, 18, 0, 'MEDIUM'], high: [-24, 18, 0, 'AIGU'] } },
  comp: { label: 'COMPRESSEUR', params: {
    thr: [-60, 0, -20, 'SEUIL'], ratio: [1, 20, 4, 'RATIO'], atk: [0.001, 0.3, 0.008, 'ATTAQUE'], rel: [0.02, 1, 0.2, 'RELACHE'], makeup: [0, 3, 1.2, 'GAIN'] } },
  gate: { label: 'TRANCE GATE', params: {
    rate: [1, 5, 3, 'DIV'], shape: [0, 1, 0.5, 'FORME'], depth: [0, 1, 1, 'PROF'] } },
}

export function makeFx(type: FxType): FxSlot {
  const p: Record<string, number> = {}
  for (const [k, def] of Object.entries(FX_DEFS[type].params)) p[k] = def[2]
  return { id: uid('fx'), type, on: true, wet: type === 'reverb' || type === 'delay' ? 0.3 : 1, p }
}

/* ------------------------------------------------------------------ */
/* Projet de démarrage : un petit beat qui tourne direct                */
/* ------------------------------------------------------------------ */

export function demoProject(): Project {
  const kick = makeChannel('drum', 'KICK 909', 0, 'kick')
  const clap = makeChannel('drum', 'CLAP XP', 1, 'clap')
  const hat = makeChannel('drum', 'HAT SEC', 2, 'hat')
  const ohat = makeChannel('drum', 'OPEN HAT', 3, 'ohat')
  const bass = makeChannel('synth', 'BASSE GRASSE', 4)
  const lead = makeChannel('synth', 'LEAD Y2K', 5)
  const smp = makeChannel('sampler', 'SAMPLE 1', 6)

  bass.synth = { ...defaultSynth(), osc1: 'saw', osc2: 'square', cutoff: 620, reso: 9, envAmt: 0.7, decay: 0.35, sustain: 0.3, sub: 0.6, unison: 1, detune: 0 }
  bass.pitch = -12
  lead.synth = { ...defaultSynth(), osc1: 'square', osc2: 'saw', cutoff: 4200, reso: 5, unison: 3, detune: 14, decay: 0.5, sustain: 0.4, release: 0.4 }
  lead.vol = 0.55

  const pat = makePattern('BEAT 1', 0)
  pat.bars = 1
  const n = (ch: string, t: number, key = 60, len = 1, vel = 0.9): Note =>
    ({ id: uid('n'), ch, t, len, key, vel, slice: -1 })

  for (const t of [0, 4, 8, 10, 14]) pat.notes.push(n(kick.id, t))
  for (const t of [4, 12]) pat.notes.push(n(clap.id, t))
  for (let t = 0; t < 16; t += 2) pat.notes.push(n(hat.id, t, 60, 1, t % 4 === 0 ? 0.85 : 0.5))
  for (const t of [6, 14]) pat.notes.push(n(ohat.id, t, 60, 1, 0.6))

  const bl = [0, 3, 6, 8, 10, 11, 14]
  const keys = [60, 60, 63, 60, 65, 63, 58]
  bl.forEach((t, i) => pat.notes.push(n(bass.id, t, keys[i], 2, 0.95)))

  const pat2 = makePattern('BEAT 2', 1)
  pat2.bars = 1
  for (const t of [0, 6, 8, 14]) pat2.notes.push(n(kick.id, t))
  for (const t of [4, 12]) pat2.notes.push(n(clap.id, t))
  for (let t = 0; t < 16; t++) pat2.notes.push(n(hat.id, t, 60, 1, t % 2 === 0 ? 0.8 : 0.35))
  ;[[0, 72], [2, 75], [4, 79], [7, 77], [8, 75], [12, 72], [14, 70]].forEach(([t, k]) =>
    pat2.notes.push(n(lead.id, t, k, 2, 0.8)))

  const inserts = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(makeInsert)
  inserts[0].fx = [makeFx('comp'), makeFx('eq3')]
  inserts[0].fx[0].p.thr = -14
  inserts[0].fx[0].p.ratio = 3

  return {
    name: 'SANS_TITRE_FINAL_v3_VRAI_FINAL',
    author: 'DJ Viteau',
    bpm: 128, swing: 0.08,
    channels: [kick, clap, hat, ohat, bass, lead, smp],
    patterns: [pat, pat2],
    currentPattern: pat.id,
    clips: [
      { id: uid('c'), pat: pat.id, track: 0, start: 0, len: 16 },
      { id: uid('c'), pat: pat.id, track: 0, start: 16, len: 16 },
      { id: uid('c'), pat: pat2.id, track: 1, start: 32, len: 16 },
      { id: uid('c'), pat: pat.id, track: 0, start: 48, len: 16 },
    ],
    inserts,
    masterVol: 0.8,
    songLenBars: 16,
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const keyName = (k: number) => `${KEY_NAMES[((k % 12) + 12) % 12]}${Math.floor(k / 12) - 1}`
export const isBlack = (k: number) => [1, 3, 6, 8, 10].includes(((k % 12) + 12) % 12)
export const midiToRate = (semis: number) => Math.pow(2, semis / 12)
export const clamp = (v: number, a: number, b: number) => v < a ? a : v > b ? b : v
export const patternSteps = (p: Pattern) => p.bars * STEPS_PER_BAR

export function songLengthSteps(p: Project): number {
  let end = 0
  for (const c of p.clips) end = Math.max(end, c.start + c.len)
  return Math.max(end, STEPS_PER_BAR)
}
