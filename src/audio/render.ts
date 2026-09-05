/* ============================================================
   DJ ViDAW — BOUNCE OFFLINE + ENCODAGE WAV
   Le rendu rejoue le morceau dans un OfflineAudioContext avec
   exactement le meme graphe, donc ce que tu exportes est ce que
   tu entends.
   ============================================================ */

import type { Project } from '../core/state'
import { STEPS_PER_BAR, patternSteps, songLengthSteps } from '../core/state'
import { buildGraph } from './graph'
import { triggerNote, type SampleBank } from './voices'
import { loadWorklets } from './fx'
import crusherUrl from '../worklets/crusher.js?url'

export interface RenderOpts {
  mode: 'pattern' | 'song'
  tail: number          // secondes de queue (reverb/delay)
  repeats: number       // nombre de repetitions en mode pattern
  sampleRate?: number
  onProgress?: (p: number) => void
}

export async function renderProject(p: Project, bank: SampleBank, o: RenderOpts): Promise<AudioBuffer> {
  const stepDur = 60 / Math.max(20, p.bpm) / 4
  const lenSteps = o.mode === 'song'
    ? Math.max(STEPS_PER_BAR, songLengthSteps(p))
    : (p.patterns.find((x) => x.id === p.currentPattern)
        ? patternSteps(p.patterns.find((x) => x.id === p.currentPattern)!) : STEPS_PER_BAR) * Math.max(1, o.repeats)

  const rate = o.sampleRate ?? 44100
  const seconds = lenSteps * stepDur + Math.max(0.2, o.tail)
  const frames = Math.ceil(seconds * rate)

  const OfflineCtor: typeof OfflineAudioContext =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
  const ctx = new OfflineCtor(2, frames, rate)
  await loadWorklets(ctx, { crusher: crusherUrl })

  const graph = buildGraph(ctx, p, false)
  graph.postMaster.connect(ctx.destination)

  const anySolo = p.channels.some((c) => c.solo)
  const swing = (step: number) => (step % 2 === 1 ? p.swing * stepDur : 0)

  const patLen = (id: string) => {
    const pat = p.patterns.find((x) => x.id === id)
    return pat ? patternSteps(pat) : STEPS_PER_BAR
  }

  for (let step = 0; step < lenSteps; step++) {
    const time = step * stepDur + swing(step) + 0.02
    const emit = (chId: string, n: { t: number; len: number; key: number; vel: number; slice: number; id: string; ch: string }) => {
      const ch = p.channels.find((c) => c.id === chId)
      if (!ch || ch.mute || (anySolo && !ch.solo)) return
      const strip = graph.channels.get(ch.id)
      if (!strip) return
      triggerNote(ctx, strip.input, ch, n, time, bank, p.bpm, stepDur)
    }
    if (o.mode === 'pattern') {
      const pat = p.patterns.find((x) => x.id === p.currentPattern)
      if (pat) {
        const local = step % patternSteps(pat)
        for (const n of pat.notes) if (n.t === local) emit(n.ch, n)
      }
    } else {
      for (const c of p.clips) {
        if (step < c.start || step >= c.start + c.len) continue
        const local = (step - c.start) % patLen(c.pat)
        const pat = p.patterns.find((x) => x.id === c.pat)
        if (!pat) continue
        for (const n of pat.notes) if (n.t === local) emit(n.ch, n)
      }
    }
    if (o.onProgress && step % 32 === 0) o.onProgress(step / lenSteps)
  }

  const out = await ctx.startRendering()
  o.onProgress?.(1)
  graph.dispose()
  return out
}

/* ------------------------------------------------------------------ */
/* Encodage WAV 16 bits PCM                                            */
/* ------------------------------------------------------------------ */

export function encodeWav(chans: Float32Array[], rate: number): Blob {
  const nCh = Math.min(2, Math.max(1, chans.length))
  const len = chans[0].length
  const bytes = len * nCh * 2
  const buf = new ArrayBuffer(44 + bytes)
  const v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }

  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, nCh, true); v.setUint32(24, rate, true)
  v.setUint32(28, rate * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, bytes, true)

  let o = 44
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      let s = chans[c][i]
      s = s < -1 ? -1 : s > 1 ? 1 : s
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      o += 2
    }
  }
  return new Blob([buf], { type: 'audio/wav' })
}

export function bufferToWav(b: AudioBuffer): Blob {
  const chans: Float32Array[] = []
  for (let c = 0; c < Math.min(2, b.numberOfChannels); c++) chans.push(b.getChannelData(c))
  if (chans.length === 1) chans.push(chans[0])
  return encodeWav(chans, b.sampleRate)
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
