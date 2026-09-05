/* ============================================================
   DJ ViDAW — BANQUE DE SAMPLES
   Decodage des fichiers importes + calcul des pics pour l'affichage
   de la forme d'onde.
   ============================================================ */

import type { SampleMeta } from '../core/state'
import { uid } from '../core/state'
import type { SampleBank } from './voices'

export interface StoredSample extends SampleMeta {
  buffer: AudioBuffer
  peaks: Float32Array  // paires min/max, 2 valeurs par colonne
}

export const PEAK_COLS = 1400

export class Samples implements SampleBank {
  private map = new Map<string, StoredSample>()
  onChange: (() => void) | null = null

  get(id: string) { return this.map.get(id)?.buffer }
  meta(id: string) { return this.map.get(id) }
  list(): StoredSample[] { return [...this.map.values()] }
  remove(id: string) { this.map.delete(id); this.onChange?.() }

  add(name: string, buffer: AudioBuffer): StoredSample {
    const s: StoredSample = {
      id: uid('smp'), name: name.replace(/\.[^.]+$/, '').slice(0, 40),
      duration: buffer.duration, channels: buffer.numberOfChannels,
      rate: buffer.sampleRate, buffer, peaks: computePeaks(buffer),
    }
    this.map.set(s.id, s)
    this.onChange?.()
    return s
  }

  async addFile(ctx: BaseAudioContext, file: File): Promise<StoredSample> {
    const raw = await file.arrayBuffer()
    const buf = await decode(ctx, raw)
    return this.add(file.name, buf)
  }
}

function decode(ctx: BaseAudioContext, raw: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((res, rej) => {
    const p = ctx.decodeAudioData(raw, res, rej)
    if (p && typeof p.then === 'function') p.then(res, rej)
  })
}

export function computePeaks(buf: AudioBuffer, cols = PEAK_COLS): Float32Array {
  const out = new Float32Array(cols * 2)
  const n = buf.length
  const per = Math.max(1, Math.floor(n / cols))
  const chans: Float32Array[] = []
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c))
  for (let i = 0; i < cols; i++) {
    const s = i * per
    const e = Math.min(n, s + per)
    let mn = 1, mx = -1
    for (let j = s; j < e; j++) {
      let v = 0
      for (const c of chans) v += c[j]
      v /= chans.length
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    if (e <= s) { mn = 0; mx = 0 }
    out[i * 2] = mn
    out[i * 2 + 1] = mx
  }
  return out
}

/* Detection de transitoires : sert au bouton "CHOP AUTO" */
export function detectSlices(buf: AudioBuffer, sensitivity = 0.5, max = 32): number[] {
  const d = buf.getChannelData(0)
  const win = Math.max(64, Math.floor(buf.sampleRate * 0.01))
  const bins = Math.floor(d.length / win)
  const energy = new Float32Array(bins)
  for (let i = 0; i < bins; i++) {
    let e = 0
    for (let j = 0; j < win; j++) { const v = d[i * win + j]; e += v * v }
    energy[i] = Math.sqrt(e / win)
  }
  let peak = 0
  for (const e of energy) if (e > peak) peak = e
  if (peak <= 0) return []
  const thr = peak * (0.12 + (1 - sensitivity) * 0.5)
  const slices: number[] = []
  let cool = 0
  for (let i = 1; i < bins; i++) {
    if (cool > 0) { cool--; continue }
    const rise = energy[i] - energy[i - 1]
    if (energy[i] > thr && rise > thr * 0.35) {
      const pos = (i * win) / d.length
      if (pos > 0.004 && pos < 0.997) slices.push(pos)
      cool = Math.floor(0.045 * buf.sampleRate / win)
    }
  }
  if (slices.length > max) {
    const stride = slices.length / max
    return Array.from({ length: max }, (_, i) => slices[Math.floor(i * stride)])
  }
  return slices
}

/* Estimation de tempo tres rustique mais suffisante pour caler une boucle */
export function guessBpm(buf: AudioBuffer): number {
  const d = buf.getChannelData(0)
  const win = Math.max(128, Math.floor(buf.sampleRate * 0.011))
  const bins = Math.floor(d.length / win)
  if (bins < 32) return 120
  const env = new Float32Array(bins)
  for (let i = 0; i < bins; i++) {
    let e = 0
    for (let j = 0; j < win; j++) { const v = d[i * win + j]; e += v * v }
    env[i] = Math.sqrt(e / win)
  }
  let best = 120, bestScore = -1
  const binRate = buf.sampleRate / win
  for (let bpm = 70; bpm <= 190; bpm += 0.5) {
    const lag = Math.round((60 / bpm) * binRate)
    if (lag < 2 || lag * 2 >= bins) continue
    let s = 0
    for (let i = 0; i + lag < bins; i++) s += env[i] * env[i + lag]
    s /= (bins - lag)
    if (s > bestScore) { bestScore = s; best = bpm }
  }
  return Math.round(best)
}
