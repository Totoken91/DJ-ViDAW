/* ============================================================
   DJ ViDAW — BANQUE DE PRESETS DU SYNTHETISEUR
   Quarante sons repartis par famille. Chaque preset est un
   ensemble de differences par rapport aux valeurs par defaut,
   fusionne en profondeur au chargement.
   ============================================================ */

import { defaultSynth, osc, env, lfo, synthFx, type SynthParams } from './synth'

export type Family = 'BASSES' | 'LEADS' | 'PLUCKS' | 'NAPPES' | 'CLAVIERS' | 'CLOCHES' | 'ARPS' | 'EFFETS'

export const FAMILIES: Family[] = ['BASSES', 'LEADS', 'PLUCKS', 'NAPPES', 'CLAVIERS', 'CLOCHES', 'ARPS', 'EFFETS']

export interface Preset { name: string; fam: Family; note: string; p: DeepPartial<SynthParams> }

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

/** Fusion recursive : un preset ne decrit que ce qui change. */
export function mergeSynth(base: SynthParams, over: DeepPartial<SynthParams>): SynthParams {
  const out = JSON.parse(JSON.stringify(base)) as SynthParams
  const walk = (dst: Record<string, unknown>, src: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') {
        walk(dst[k] as Record<string, unknown>, v as Record<string, unknown>)
      } else dst[k] = v
    }
  }
  walk(out as unknown as Record<string, unknown>, over as Record<string, unknown>)
  return out
}

export function loadPreset(i: number): SynthParams {
  const p = PRESETS[Math.max(0, Math.min(PRESETS.length - 1, i))]
  return mergeSynth(defaultSynth(), p.p)
}

const F = (kind: SynthParams['filter']['kind'], cutoff: number, reso: number, envAmt: number, key = 0.3, drive = 0) =>
  ({ kind, cutoff, reso, env: envAmt, key, drive })

export const PRESETS: Preset[] = [

  /* ---------------- BASSES ---------------- */
  { name: '303 ACIDE', fam: 'BASSES', note: 'monte la RESONANCE, c\'est fait pour', p: {
    oscA: osc({ wave: 'saw', unison: 1 }), oscB: osc({ wave: 'square', level: 0 }), mix: 0,
    sub: { wave: 'sine', oct: -1, level: 0.45 },
    filter: F('lp24', 240, 19, 0.78, 0.15, 0.35),
    ampEnv: env(0.004, 0.4, 0.55, 0.12), filtEnv: env(0.002, 0.22, 0.02, 0.1),
    glide: 0.055, mono: true, gain: 0.9, fx: synthFx({ drive: 0.3 }) } },

  { name: 'SUB PROFOND', fam: 'BASSES', note: 'pour les enceintes qui descendent', p: {
    oscA: osc({ wave: 'sine', unison: 1 }), oscB: osc({ wave: 'triangle', level: 0.35 }), mix: 0.2,
    sub: { wave: 'sine', oct: -1, level: 0.8 }, noise: 0,
    filter: F('lp12', 260, 0.8, 0.15, 0.2, 0.12),
    ampEnv: env(0.01, 0.5, 0.9, 0.14), filtEnv: env(0.01, 0.3, 0.5, 0.1),
    mono: true, gain: 1 } },

  { name: 'REESE', fam: 'BASSES', note: 'deux scies qui se battent', p: {
    oscA: osc({ wave: 'saw', unison: 2, detune: 34, spread: 0.7 }),
    oscB: osc({ wave: 'saw', fine: 16, unison: 2, detune: 30, spread: 0.7 }), mix: 0.5,
    sub: { wave: 'sine', oct: -1, level: 0.5 },
    filter: F('lp24', 900, 3.5, 0.35, 0.25, 0.2),
    ampEnv: env(0.01, 0.5, 0.85, 0.2), filtEnv: env(0.02, 0.6, 0.4, 0.2),
    lfo2: lfo({ shape: 'sine', rate: 0.22, toCut: 0.22 }),
    gain: 0.85, fx: synthFx({ chorus: 0.3, drive: 0.2 }) } },

  { name: 'BASSE METAL', fam: 'BASSES', note: 'modulation en anneau, ca cogne', p: {
    oscA: osc({ wave: 'saw', unison: 1 }), oscB: osc({ wave: 'square', oct: 1, semi: 7 }), mix: 0.3,
    ring: 0.55, sub: { wave: 'square', oct: -1, level: 0.35 },
    filter: F('lp24', 700, 8, 0.55, 0.2, 0.4),
    ampEnv: env(0.003, 0.35, 0.4, 0.15), filtEnv: env(0.002, 0.3, 0.1, 0.14),
    mono: true, gain: 0.8, fx: synthFx({ drive: 0.4 }) } },

  { name: 'PLUCK BASSE', fam: 'BASSES', note: 'court, sec, efficace', p: {
    oscA: osc({ wave: 'square', unison: 1 }), oscB: osc({ wave: 'saw', level: 0.6 }), mix: 0.4,
    sub: { wave: 'sine', oct: -1, level: 0.5 },
    filter: F('lp24', 380, 9, 0.7, 0.25, 0.2),
    ampEnv: env(0.002, 0.19, 0, 0.1), filtEnv: env(0.001, 0.12, 0, 0.09),
    gain: 0.95 } },

  { name: 'GROWL', fam: 'BASSES', note: 'un LFO aleatoire sur le filtre', p: {
    oscA: osc({ wave: 'saw', unison: 3, detune: 18 }), oscB: osc({ wave: 'square', oct: -1, level: 0.6 }), mix: 0.35,
    sub: { wave: 'sine', oct: -1, level: 0.4 },
    filter: F('lp24', 420, 14, 0.6, 0.2, 0.45),
    ampEnv: env(0.006, 0.5, 0.8, 0.16), filtEnv: env(0.01, 0.4, 0.3, 0.14),
    lfo1: lfo({ shape: 'sh', rate: 13, toCut: 0.55 }),
    gain: 0.85, fx: synthFx({ drive: 0.45 }) } },

  { name: 'BASSE CHAUDE', fam: 'BASSES', note: 'ronde, sans agressivite', p: {
    oscA: osc({ wave: 'triangle', unison: 1 }), oscB: osc({ wave: 'saw', level: 0.5 }), mix: 0.3,
    sub: { wave: 'sine', oct: -1, level: 0.55 },
    filter: F('lp12', 520, 1.6, 0.4, 0.3, 0.15),
    ampEnv: env(0.008, 0.6, 0.75, 0.22), filtEnv: env(0.01, 0.4, 0.35, 0.2),
    gain: 0.9 } },

  /* ---------------- LEADS ---------------- */
  { name: 'SUPERSAW', fam: 'LEADS', note: 'quatorze oscillateurs, oui', p: {
    oscA: osc({ wave: 'saw', unison: 7, detune: 26, spread: 0.95 }),
    oscB: osc({ wave: 'saw', oct: 1, unison: 5, detune: 18, spread: 0.8, level: 0.55 }), mix: 0.32,
    sub: { wave: 'sine', oct: -1, level: 0.2 },
    filter: F('lp24', 6800, 1.4, 0.3, 0.4, 0.12),
    ampEnv: env(0.012, 0.6, 0.85, 0.5), filtEnv: env(0.02, 0.7, 0.6, 0.4),
    gain: 0.62, fx: synthFx({ chorus: 0.45, delay: 0.28, delayDiv: 4, delayFb: 0.32, reverb: 0.3, size: 2.6 }) } },

  { name: 'LEAD 8 BITS', fam: 'LEADS', note: 'impulsion etroite, zero filtre', p: {
    oscA: osc({ wave: 'pulse', pw: 0.22, unison: 1 }), oscB: osc({ wave: 'pulse', pw: 0.12, oct: 1, level: 0.4 }), mix: 0.25,
    filter: F('off', 12000, 0.7, 0, 0, 0),
    ampEnv: env(0.001, 0.12, 0.75, 0.05), filtEnv: env(0.001, 0.1, 0.5, 0.05),
    mono: true, gain: 0.62, fx: synthFx({ delay: 0.22, delayDiv: 5, delayFb: 0.28 }) } },

  { name: 'LEAD TRANCE', fam: 'LEADS', note: 'le filtre respire au tempo', p: {
    oscA: osc({ wave: 'saw', unison: 5, detune: 22, spread: 0.85 }),
    oscB: osc({ wave: 'square', oct: -1, level: 0.5 }), mix: 0.3,
    filter: F('lp24', 2400, 6, 0.55, 0.35, 0.15),
    ampEnv: env(0.01, 0.5, 0.8, 0.4), filtEnv: env(0.02, 0.5, 0.35, 0.3),
    lfo2: lfo({ shape: 'tri', sync: true, div: 6, toCut: 0.4 }),
    gain: 0.66, fx: synthFx({ chorus: 0.35, delay: 0.32, delayDiv: 3, delayFb: 0.4, reverb: 0.28 }) } },

  { name: 'SIFFLET', fam: 'LEADS', note: 'vibrato qui arrive apres coup', p: {
    oscA: osc({ wave: 'sine', unison: 1 }), oscB: osc({ wave: 'triangle', level: 0.3 }), mix: 0.25,
    filter: F('lp12', 4200, 1, 0.2, 0.5, 0),
    ampEnv: env(0.05, 0.4, 0.9, 0.25), filtEnv: env(0.05, 0.4, 0.7, 0.2),
    lfo1: lfo({ shape: 'sine', rate: 5.6, fade: 0.35, toPitch: 22 }),
    mono: true, glide: 0.05, gain: 0.7, fx: synthFx({ reverb: 0.3, delay: 0.2, delayDiv: 4 }) } },

  { name: 'SCREECH', fam: 'LEADS', note: 'resonance a fond, rampe sur le filtre', p: {
    oscA: osc({ wave: 'saw', unison: 3, detune: 20 }), oscB: osc({ wave: 'saw', semi: 7, level: 0.6 }), mix: 0.4,
    filter: F('lp24', 900, 22, 0.7, 0.3, 0.55),
    ampEnv: env(0.004, 0.4, 0.7, 0.18), filtEnv: env(0.004, 0.35, 0.2, 0.15),
    lfo1: lfo({ shape: 'saw', rate: 7.5, toCut: 0.5 }),
    gain: 0.6, fx: synthFx({ drive: 0.5, delay: 0.2, delayDiv: 5 }) } },

  { name: 'FLUTE SYNTHE', fam: 'LEADS', note: 'un souffle de bruit dans le sinus', p: {
    oscA: osc({ wave: 'sine', unison: 1 }), oscB: osc({ wave: 'triangle', level: 0.35 }), mix: 0.3,
    noise: 0.07,
    filter: F('lp12', 2600, 1.2, 0.25, 0.5, 0),
    ampEnv: env(0.07, 0.3, 0.9, 0.2), filtEnv: env(0.08, 0.3, 0.6, 0.2),
    lfo1: lfo({ shape: 'sine', rate: 4.8, fade: 0.4, toPitch: 12 }),
    gain: 0.72, fx: synthFx({ reverb: 0.35, size: 2.4 }) } },

  { name: 'LEAD BRASS', fam: 'LEADS', note: 'attaque du filtre un peu lente', p: {
    oscA: osc({ wave: 'saw', unison: 3, detune: 12 }), oscB: osc({ wave: 'saw', fine: -8, level: 0.7 }), mix: 0.45,
    filter: F('lp24', 1500, 3.5, 0.5, 0.4, 0.2),
    ampEnv: env(0.05, 0.4, 0.85, 0.25), filtEnv: env(0.09, 0.5, 0.5, 0.25),
    gain: 0.7, fx: synthFx({ chorus: 0.25, reverb: 0.25 }) } },

  /* ---------------- PLUCKS ---------------- */
  { name: 'PLUCK Y2K', fam: 'PLUCKS', note: 'court, brillant, avec de l\'echo', p: {
    oscA: osc({ wave: 'square', unison: 3, detune: 10, spread: 0.6 }),
    oscB: osc({ wave: 'saw', oct: 1, level: 0.5 }), mix: 0.35,
    filter: F('lp24', 3000, 8, 0.65, 0.5, 0.1),
    ampEnv: env(0.002, 0.24, 0, 0.22), filtEnv: env(0.001, 0.16, 0, 0.18),
    gain: 0.72, fx: synthFx({ delay: 0.34, delayDiv: 4, delayFb: 0.42, reverb: 0.3, size: 2.2 }) } },

  { name: 'MARIMBA', fam: 'PLUCKS', note: 'sinus nu, decroissance rapide', p: {
    oscA: osc({ wave: 'sine', unison: 1 }), oscB: osc({ wave: 'sine', oct: 2, level: 0.22 }), mix: 0.2,
    filter: F('lp12', 5000, 0.8, 0.2, 0.6, 0),
    ampEnv: env(0.001, 0.35, 0, 0.3), filtEnv: env(0.001, 0.2, 0, 0.2),
    gain: 0.85, fx: synthFx({ reverb: 0.25, size: 1.6 }) } },

  { name: 'KOTO', fam: 'PLUCKS', note: 'corde pincee, un peu metallique', p: {
    oscA: osc({ wave: 'triangle', unison: 2, detune: 8 }), oscB: osc({ wave: 'saw', level: 0.4 }), mix: 0.3,
    filter: F('lp24', 2200, 5, 0.6, 0.55, 0.15),
    ampEnv: env(0.001, 0.5, 0, 0.4), filtEnv: env(0.001, 0.25, 0, 0.2),
    gain: 0.8, fx: synthFx({ reverb: 0.35, size: 2.2, delay: 0.16, delayDiv: 5 }) } },

  { name: 'PLUCK VERRE', fam: 'PLUCKS', note: 'aigu, cristallin, tres reverbere', p: {
    oscA: osc({ wave: 'sine', oct: 1, unison: 1 }), oscB: osc({ wave: 'triangle', oct: 2, level: 0.4 }), mix: 0.35,
    ring: 0.2,
    filter: F('lp12', 7000, 1.5, 0.3, 0.6, 0),
    ampEnv: env(0.001, 0.45, 0, 0.5), filtEnv: env(0.001, 0.3, 0, 0.3),
    gain: 0.72, fx: synthFx({ reverb: 0.55, size: 3.4, delay: 0.24, delayDiv: 5, delayFb: 0.4 }) } },

  { name: 'STAB HOUSE', fam: 'PLUCKS', note: 'a jouer en accords', p: {
    oscA: osc({ wave: 'saw', unison: 3, detune: 16, spread: 0.7 }), oscB: osc({ wave: 'square', level: 0.5 }), mix: 0.4,
    filter: F('lp24', 2000, 6, 0.6, 0.4, 0.2),
    ampEnv: env(0.003, 0.3, 0.05, 0.18), filtEnv: env(0.002, 0.2, 0.05, 0.16),
    gain: 0.7, fx: synthFx({ chorus: 0.3, reverb: 0.3, size: 1.8 }) } },

  /* ---------------- NAPPES ---------------- */
  { name: 'NAPPE MSN', fam: 'NAPPES', note: 'la nappe de fond par excellence', p: {
    oscA: osc({ wave: 'saw', unison: 5, detune: 20, spread: 0.9 }),
    oscB: osc({ wave: 'saw', oct: -1, unison: 3, detune: 14, level: 0.6 }), mix: 0.4,
    filter: F('lp24', 1700, 2.2, 0.35, 0.4, 0.05),
    ampEnv: env(0.55, 1.2, 0.85, 1.4), filtEnv: env(0.7, 1.2, 0.6, 1.2),
    lfo2: lfo({ shape: 'sine', rate: 0.22, toCut: 0.18 }),
    gain: 0.55, fx: synthFx({ chorus: 0.65, reverb: 0.6, size: 4, delay: 0.2, delayDiv: 1, delayFb: 0.3 }) } },

  { name: 'NAPPE CHAUDE', fam: 'NAPPES', note: 'douce, sans agressivite', p: {
    oscA: osc({ wave: 'triangle', unison: 3, detune: 10, spread: 0.7 }),
    oscB: osc({ wave: 'saw', level: 0.4 }), mix: 0.3,
    filter: F('lp12', 1200, 1.4, 0.3, 0.4, 0),
    ampEnv: env(0.85, 1.4, 0.9, 1.7), filtEnv: env(1, 1.4, 0.7, 1.4),
    gain: 0.6, fx: synthFx({ chorus: 0.5, reverb: 0.55, size: 4.4 }) } },

  { name: 'CHOEUR SPATIAL', fam: 'NAPPES', note: 'le panoramique tourne lentement', p: {
    oscA: osc({ wave: 'saw', unison: 7, detune: 24, spread: 1 }),
    oscB: osc({ wave: 'triangle', oct: 1, level: 0.35 }), mix: 0.3,
    filter: F('lp24', 2600, 2, 0.3, 0.5, 0),
    ampEnv: env(0.7, 1.5, 0.9, 2), filtEnv: env(0.9, 1.5, 0.7, 1.6),
    lfo1: lfo({ shape: 'sine', rate: 0.13, toPan: 0.75 }),
    gain: 0.5, fx: synthFx({ chorus: 0.7, reverb: 0.75, size: 5.2 }) } },

  { name: 'NAPPE SOMBRE', fam: 'NAPPES', note: 'pour les passages inquietants', p: {
    oscA: osc({ wave: 'saw', unison: 4, detune: 18, spread: 0.8 }),
    oscB: osc({ wave: 'square', oct: -1, level: 0.5 }), mix: 0.45,
    noise: 0.04,
    filter: F('lp24', 520, 4, 0.25, 0.3, 0.1),
    ampEnv: env(1.1, 1.6, 0.85, 2.2), filtEnv: env(1.4, 1.6, 0.6, 1.8),
    lfo2: lfo({ shape: 'sine', rate: 0.09, toCut: 0.3 }),
    gain: 0.6, fx: synthFx({ reverb: 0.7, size: 5.6, chorus: 0.35 }) } },

  { name: 'DRONE', fam: 'NAPPES', note: 'ne s\'arrete jamais vraiment', p: {
    oscA: osc({ wave: 'saw', unison: 5, detune: 30, spread: 1 }),
    oscB: osc({ wave: 'saw', semi: 7, unison: 3, detune: 22, level: 0.6 }), mix: 0.5,
    noise: 0.1,
    filter: F('bp', 700, 3, 0.4, 0.2, 0.2),
    ampEnv: env(1.6, 2, 0.9, 3), filtEnv: env(2, 2, 0.7, 2.4),
    lfo1: lfo({ shape: 'sh', rate: 0.5, toCut: 0.4 }),
    gain: 0.5, fx: synthFx({ reverb: 0.8, size: 6, drive: 0.2 }) } },

  { name: 'CORDES', fam: 'NAPPES', note: 'section de cordes de synthese', p: {
    oscA: osc({ wave: 'saw', unison: 7, detune: 16, spread: 0.9 }),
    oscB: osc({ wave: 'saw', oct: 1, unison: 3, detune: 10, level: 0.4 }), mix: 0.3,
    filter: F('lp24', 3200, 1.8, 0.35, 0.5, 0.05),
    ampEnv: env(0.28, 0.8, 0.9, 0.9), filtEnv: env(0.35, 0.9, 0.7, 0.8),
    gain: 0.55, fx: synthFx({ chorus: 0.55, reverb: 0.5, size: 3.4 }) } },

  /* ---------------- CLAVIERS ---------------- */
  { name: 'PIANO ELECTRIQUE', fam: 'CLAVIERS', note: 'sinus + anneau, comme un Rhodes', p: {
    oscA: osc({ wave: 'sine', unison: 1 }), oscB: osc({ wave: 'sine', oct: 2, semi: 0 }), mix: 0.25,
    ring: 0.35,
    filter: F('lp12', 3600, 1, 0.3, 0.6, 0.1),
    ampEnv: env(0.002, 1.1, 0.18, 0.45), filtEnv: env(0.002, 0.5, 0.15, 0.35),
    velAmp: 0.85, velCut: 0.5,
    gain: 0.8, fx: synthFx({ chorus: 0.3, reverb: 0.28, size: 2 }) } },

  { name: 'CLAVINET', fam: 'CLAVIERS', note: 'impulsion tres etroite, funky', p: {
    oscA: osc({ wave: 'pulse', pw: 0.14, unison: 1 }), oscB: osc({ wave: 'square', level: 0.35 }), mix: 0.25,
    filter: F('lp24', 2400, 7, 0.55, 0.5, 0.35),
    ampEnv: env(0.001, 0.3, 0.08, 0.12), filtEnv: env(0.001, 0.18, 0.05, 0.12),
    velAmp: 0.8, gain: 0.78, fx: synthFx({ drive: 0.3 }) } },

  { name: 'ORGUE ROCK', fam: 'CLAVIERS', note: 'trois sinus et de la saturation', p: {
    oscA: osc({ wave: 'sine', unison: 1 }), oscB: osc({ wave: 'sine', oct: 1, semi: 7 }), mix: 0.4,
    sub: { wave: 'sine', oct: -1, level: 0.5 },
    filter: F('lp12', 5000, 0.8, 0.1, 0.4, 0.3),
    ampEnv: env(0.004, 0.1, 1, 0.06), filtEnv: env(0.004, 0.1, 1, 0.06),
    lfo1: lfo({ shape: 'sine', rate: 6.2, toAmp: 0.16, fade: 0.2 }),
    gain: 0.7, fx: synthFx({ drive: 0.35, chorus: 0.25, reverb: 0.2 }) } },

  { name: 'ORGUE EGLISE', fam: 'CLAVIERS', note: 'a jouer tres fort', p: {
    oscA: osc({ wave: 'sine', unison: 2, detune: 4 }), oscB: osc({ wave: 'sine', oct: 1, level: 0.5 }), mix: 0.4,
    sub: { wave: 'sine', oct: -1, level: 0.6 },
    filter: F('lp12', 4000, 0.7, 0.1, 0.4, 0),
    ampEnv: env(0.08, 0.2, 1, 0.5), filtEnv: env(0.08, 0.2, 1, 0.4),
    gain: 0.62, fx: synthFx({ reverb: 0.8, size: 5.6 }) } },

  /* ---------------- CLOCHES ---------------- */
  { name: 'CLOCHE CRISTAL', fam: 'CLOCHES', note: 'anneau a fond, decroissance longue', p: {
    oscA: osc({ wave: 'sine', unison: 1 }), oscB: osc({ wave: 'sine', oct: 2, semi: 7 }), mix: 0.3,
    ring: 0.75,
    filter: F('lp12', 8000, 1, 0.2, 0.6, 0),
    ampEnv: env(0.001, 1.6, 0, 1.4), filtEnv: env(0.001, 0.8, 0, 0.6),
    gain: 0.72, fx: synthFx({ reverb: 0.6, size: 4.4, delay: 0.2, delayDiv: 4, delayFb: 0.35 }) } },

  { name: 'BOITE A MUSIQUE', fam: 'CLOCHES', note: 'fragile, un peu triste', p: {
    oscA: osc({ wave: 'sine', oct: 1, unison: 1 }), oscB: osc({ wave: 'triangle', oct: 2, level: 0.3 }), mix: 0.25,
    filter: F('lp12', 6000, 1.2, 0.3, 0.6, 0),
    ampEnv: env(0.001, 1.2, 0, 1), filtEnv: env(0.001, 0.5, 0, 0.4),
    gain: 0.7, fx: synthFx({ reverb: 0.55, size: 3.6 }) } },

  { name: 'CLOCHE METAL', fam: 'CLOCHES', note: 'inharmonique, presque une alarme', p: {
    oscA: osc({ wave: 'square', unison: 1 }), oscB: osc({ wave: 'square', semi: 6, oct: 1 }), mix: 0.4,
    ring: 0.9, noise: 0.05,
    filter: F('bp', 2600, 4, 0.35, 0.4, 0.2),
    ampEnv: env(0.001, 1.4, 0.05, 1.2), filtEnv: env(0.001, 0.7, 0.1, 0.6),
    gain: 0.6, fx: synthFx({ reverb: 0.5, size: 3.8, drive: 0.2 }) } },

  /* ---------------- ARPS ---------------- */
  { name: 'ARP CRISTAL', fam: 'ARPS', note: 'avec l\'arpegiateur du piano roll', p: {
    oscA: osc({ wave: 'saw', unison: 3, detune: 12, spread: 0.7 }),
    oscB: osc({ wave: 'sine', oct: 1, level: 0.35 }), mix: 0.3,
    filter: F('lp24', 3800, 5, 0.55, 0.55, 0.1),
    ampEnv: env(0.002, 0.2, 0, 0.2), filtEnv: env(0.001, 0.14, 0, 0.14),
    gain: 0.66, fx: synthFx({ delay: 0.4, delayDiv: 5, delayFb: 0.5, reverb: 0.35, size: 2.8, chorus: 0.25 }) } },

  { name: 'SEQ ACIDE', fam: 'ARPS', note: '303 avec de l\'echo', p: {
    oscA: osc({ wave: 'saw', unison: 1 }), oscB: osc({ wave: 'square', level: 0 }), mix: 0,
    sub: { wave: 'sine', oct: -1, level: 0.3 },
    filter: F('lp24', 400, 17, 0.72, 0.3, 0.3),
    ampEnv: env(0.003, 0.25, 0.1, 0.1), filtEnv: env(0.002, 0.18, 0, 0.1),
    glide: 0.03, gain: 0.8,
    fx: synthFx({ drive: 0.28, delay: 0.3, delayDiv: 4, delayFb: 0.45, reverb: 0.18 }) } },

  { name: 'ARP CARRE', fam: 'ARPS', note: 'sec et net, facon console', p: {
    oscA: osc({ wave: 'pulse', pw: 0.35, unison: 1 }), oscB: osc({ wave: 'pulse', pw: 0.2, oct: 1, level: 0.4 }), mix: 0.3,
    filter: F('lp12', 4200, 2, 0.4, 0.5, 0.1),
    ampEnv: env(0.001, 0.16, 0, 0.1), filtEnv: env(0.001, 0.12, 0, 0.1),
    gain: 0.66, fx: synthFx({ delay: 0.32, delayDiv: 5, delayFb: 0.4 }) } },

  /* ---------------- EFFETS ---------------- */
  { name: 'RISER', fam: 'EFFETS', note: 'tiens une note longue avant le drop', p: {
    oscA: osc({ wave: 'saw', unison: 5, detune: 30, spread: 1 }), oscB: osc({ wave: 'saw', level: 0 }), mix: 0,
    noise: 0.35,
    filter: F('lp24', 300, 8, 0.95, 0.2, 0.3),
    ampEnv: env(0.4, 2, 1, 0.4), filtEnv: env(3.2, 2, 1, 0.4),
    lfo1: lfo({ shape: 'sine', rate: 7, fade: 1.2, toPitch: 45 }),
    gain: 0.6, fx: synthFx({ reverb: 0.5, size: 4, drive: 0.25 }) } },

  { name: 'LASER', fam: 'EFFETS', note: 'chute de hauteur immediate', p: {
    oscA: osc({ wave: 'saw', unison: 1 }), oscB: osc({ wave: 'square', level: 0.4 }), mix: 0.3,
    filter: F('lp24', 6000, 10, 0.9, 0.4, 0.3),
    ampEnv: env(0.001, 0.28, 0, 0.1), filtEnv: env(0.001, 0.1, 0, 0.08),
    lfo1: lfo({ shape: 'saw', rate: 3.5, toPitch: -900 }),
    gain: 0.7, fx: synthFx({ delay: 0.25, delayDiv: 6, delayFb: 0.5 }) } },

  { name: 'VENT', fam: 'EFFETS', note: 'du bruit dans un passe-bande', p: {
    oscA: osc({ wave: 'noise', unison: 1 }), oscB: osc({ wave: 'noise', level: 0.5 }), mix: 0.4,
    filter: F('bp', 900, 9, 0.5, 0, 0),
    ampEnv: env(0.9, 1.4, 0.8, 1.6), filtEnv: env(1.2, 1.6, 0.5, 1.4),
    lfo1: lfo({ shape: 'sine', rate: 0.16, toCut: 0.6 }),
    gain: 0.55, fx: synthFx({ reverb: 0.6, size: 5 }) } },

  { name: 'ALARME', fam: 'EFFETS', note: 'personne ne t\'aimera pour ca', p: {
    oscA: osc({ wave: 'square', unison: 1 }), oscB: osc({ wave: 'saw', level: 0.4 }), mix: 0.3,
    filter: F('lp12', 3000, 3, 0.3, 0.3, 0.3),
    ampEnv: env(0.01, 0.2, 1, 0.1), filtEnv: env(0.01, 0.2, 1, 0.1),
    lfo1: lfo({ shape: 'tri', rate: 1.6, toPitch: 700 }),
    gain: 0.55, fx: synthFx({ drive: 0.3, reverb: 0.3 }) } },

  { name: 'GLITCH', fam: 'EFFETS', note: 'hauteur et filtre tires au sort', p: {
    oscA: osc({ wave: 'square', unison: 2, detune: 20 }), oscB: osc({ wave: 'saw', oct: 1, level: 0.5 }), mix: 0.4,
    filter: F('bp', 1800, 12, 0.5, 0.3, 0.4),
    ampEnv: env(0.001, 0.3, 0.4, 0.1), filtEnv: env(0.001, 0.2, 0.3, 0.1),
    lfo1: lfo({ shape: 'sh', rate: 22, toPitch: 300 }),
    lfo2: lfo({ shape: 'sh', rate: 14, toCut: 0.7 }),
    gain: 0.6, fx: synthFx({ drive: 0.4, delay: 0.25, delayDiv: 6, delayFb: 0.5 }) } },
]

export const presetsByFamily = (f: Family) =>
  PRESETS.map((p, i) => ({ p, i })).filter((x) => x.p.fam === f)
