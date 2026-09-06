/* ============================================================
   DJ ViDAW — GRAPHE AUDIO
   channel -> gain -> pan -> insert(FX) -> master -> limiteur -> sortie
   Construit a l'identique en live et en offline.
   ============================================================ */

import type { Project, Channel } from '../core/state'
import { clamp } from '../core/state'
import { buildFx, type FxNode } from './fx'
import { buildSynthFx, type SynthFxChain } from './synth'

export interface ChannelStrip {
  input: GainNode
  gain: GainNode
  pan: StereoPannerNode | null
  /** Dernier noeud avant l'insert : sert au reroutage a chaud. */
  tail: AudioNode
  /** Effets integres au preset, pour les channels synthetiseur. */
  fx: SynthFxChain | null
  insert: number
}

export interface InsertStrip {
  input: GainNode
  chain: FxNode[]
  gain: GainNode
  pan: StereoPannerNode | null
  analyser: AnalyserNode | null
}

export interface Graph {
  ctx: BaseAudioContext
  channels: Map<string, ChannelStrip>
  inserts: InsertStrip[]
  master: GainNode
  limiter: DynamicsCompressorNode
  postMaster: GainNode
  analyser: AnalyserNode | null
  applyMix(p: Project): void
  updateFx(p: Project): void
  dispose(): void
}

function pannerOrNull(ctx: BaseAudioContext): StereoPannerNode | null {
  return typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null
}

export function buildGraph(ctx: BaseAudioContext, p: Project, withAnalysers: boolean): Graph {
  const master = ctx.createGain()
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1.5
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.002
  limiter.release.value = 0.12
  const postMaster = ctx.createGain()
  postMaster.gain.value = 1
  master.connect(limiter).connect(postMaster)

  const analyser = withAnalysers ? ctx.createAnalyser() : null
  if (analyser) {
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.72
    postMaster.connect(analyser)
  }

  const inserts: InsertStrip[] = []
  for (let ii = 0; ii < p.inserts.length; ii++) {
    const input = ctx.createGain()
    const gain = ctx.createGain()
    const pan = pannerOrNull(ctx)
    const an = withAnalysers ? ctx.createAnalyser() : null
    if (an) { an.fftSize = 512; an.smoothingTimeConstant = 0.5 }
    inserts.push({ input, chain: [], gain, pan, analyser: an })
  }

  // Cablage des inserts (0 = master, les autres arrivent dans le master)
  const wireInsert = (i: number) => {
    const s = inserts[i]
    let node: AudioNode = s.input
    for (const fx of s.chain) { node.connect(fx.in); node = fx.out }
    node.connect(s.gain)
    let tail: AudioNode = s.gain
    if (s.pan) { s.gain.connect(s.pan); tail = s.pan }
    if (s.analyser) tail.connect(s.analyser)
    if (i === 0) tail.connect(master)
    else tail.connect(inserts[0].input)
  }

  const rebuildChains = () => {
    p.inserts.forEach((ins, i) => {
      const s = inserts[i]
      s.chain.forEach((f) => f.dispose?.())
      try { s.input.disconnect() } catch { /* rien */ }
      try { s.gain.disconnect() } catch { /* rien */ }
      if (s.pan) { try { s.pan.disconnect() } catch { /* rien */ } }
      s.chain = ins.fx.filter((f) => f.on).map((f) => buildFx(ctx, f, p.bpm))
      wireInsert(i)
    })
  }
  rebuildChains()

  const channels = new Map<string, ChannelStrip>()
  const wireChannel = (ch: Channel) => {
    const input = ctx.createGain()
    const gain = ctx.createGain()
    const pan = pannerOrNull(ctx)
    input.connect(gain)
    let node: AudioNode = gain
    let fx: SynthFxChain | null = null
    if (ch.type === 'synth' && ch.synth) {
      fx = buildSynthFx(ctx, ch.synth.fx, p.bpm)
      gain.connect(fx.input)
      node = fx.output
    }
    if (pan) { node.connect(pan); node = pan }
    node.connect(inserts[clamp(ch.insert, 0, inserts.length - 1)].input)
    channels.set(ch.id, { input, gain, pan, tail: node, fx, insert: ch.insert })
  }
  p.channels.forEach(wireChannel)

  let fxSignature = signature(p)

  const g: Graph = {
    ctx, channels, inserts, master, limiter, postMaster, analyser,

    applyMix(pr) {
      const anySolo = pr.channels.some((c) => c.solo)
      // Ajout/suppression de channels a chaud
      for (const ch of pr.channels) if (!channels.has(ch.id)) wireChannel(ch)
      for (const id of [...channels.keys()]) {
        if (!pr.channels.find((c) => c.id === id)) {
          const s = channels.get(id)!
          s.fx?.stop()
          try { s.input.disconnect(); s.gain.disconnect(); s.pan?.disconnect(); s.tail.disconnect() } catch { /* rien */ }
          channels.delete(id)
        }
      }
      for (const ch of pr.channels) {
        const s = channels.get(ch.id)
        if (!s) continue
        if (s.insert !== ch.insert) {
          try { s.tail.disconnect() } catch { /* rien */ }
          s.tail.connect(inserts[clamp(ch.insert, 0, inserts.length - 1)].input)
          s.insert = ch.insert
        }
        if (s.fx && ch.synth) s.fx.update(ch.synth.fx, pr.bpm)
        const audible = ch.mute ? 0 : (anySolo && !ch.solo ? 0 : ch.vol)
        s.gain.gain.value = audible
        if (s.pan) s.pan.pan.value = clamp(ch.pan, -1, 1)
      }
      pr.inserts.forEach((ins, i) => {
        const s = inserts[i]
        if (!s) return
        s.gain.gain.value = ins.mute ? 0 : ins.vol
        if (s.pan) s.pan.pan.value = clamp(ins.pan, -1, 1)
      })
      master.gain.value = pr.masterVol
    },

    updateFx(pr) {
      const sig = signature(pr)
      if (sig !== fxSignature) { rebuildChains(); fxSignature = sig }
      pr.inserts.forEach((ins, i) => {
        const s = inserts[i]
        if (!s) return
        const active = ins.fx.filter((f) => f.on)
        active.forEach((slot, j) => s.chain[j]?.update(slot, pr.bpm))
      })
    },

    dispose() {
      channels.forEach((s) => s.fx?.stop())
      inserts.forEach((s) => s.chain.forEach((f) => f.dispose?.()))
      try { master.disconnect(); limiter.disconnect(); postMaster.disconnect() } catch { /* rien */ }
    },
  }

  g.applyMix(p)
  g.updateFx(p)
  return g
}

/* La signature ne change que lorsque la topologie change (ajout/retrait/bypass
   d'un effet), pas quand on tourne un bouton — evite de tout reconstruire. */
function signature(p: Project): string {
  return p.inserts.map((i) => i.fx.map((f) => `${f.type}${f.on ? 1 : 0}`).join(',')).join('|')
}
