/* ============================================================
   DJ ViDAW — RACK D'EFFETS
   Chaque effet est une fabrique (ctx, params) -> { in, out, update }
   pour etre reconstruit a l'identique dans un OfflineAudioContext.
   ============================================================ */

import type { FxSlot, FxType } from '../core/state'
import { clamp } from '../core/state'
import { driveCurve, noiseBuffer, type F32 } from './voices'

export interface FxNode {
  in: AudioNode
  out: AudioNode
  update(slot: FxSlot, bpm: number): void
  dispose?(): void
}

const crusherLoaded = new WeakSet<BaseAudioContext>()

/* Les worklets sont charges depuis leur code source plutot que depuis un
   fichier : une Blob URL fonctionne aussi bien dans un bundle multi-fichiers
   que dans une page unique embarquee, sans chemin d'asset a resoudre. */
const blobUrls = new Map<string, string>()
function moduleUrl(src: string): string {
  let u = blobUrls.get(src)
  if (!u) {
    u = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
    blobUrls.set(src, u)
  }
  return u
}

export async function loadWorklets(ctx: BaseAudioContext, src: { crusher: string; tap?: string }) {
  if (crusherLoaded.has(ctx)) return
  const anyCtx = ctx as unknown as { audioWorklet?: AudioWorklet }
  if (!anyCtx.audioWorklet) return
  try {
    await anyCtx.audioWorklet.addModule(moduleUrl(src.crusher))
    if (src.tap) await anyCtx.audioWorklet.addModule(moduleUrl(src.tap))
    crusherLoaded.add(ctx)
  } catch (e) {
    // Certaines integrations bloquent les Blob URL : on retombe sur le waveshaper.
    console.warn('[ViDAW] worklet indisponible, repli sur waveshaper', e)
  }
}
export function hasWorklet(ctx: BaseAudioContext) { return crusherLoaded.has(ctx) }

/* --- Reverbe : impulsion generee par bruit decroissant -------------- */
const irCache = new Map<string, AudioBuffer>()
export function makeIR(ctx: BaseAudioContext, seconds: number, damp: number): AudioBuffer {
  const key = `${ctx.sampleRate}|${seconds.toFixed(2)}|${Math.round(damp)}`
  const hit = irCache.get(key)
  if (hit) return hit
  const len = Math.max(1, Math.floor(ctx.sampleRate * clamp(seconds, 0.05, 8)))
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  // filtre passe-bas 1 pole applique au bruit -> amortissement des aigus
  const coef = Math.exp(-2 * Math.PI * clamp(damp, 200, 18000) / ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    let z = 0
    for (let i = 0; i < len; i++) {
      const t = i / len
      const env = Math.pow(1 - t, 2.6) * (1 - Math.exp(-i / 220))
      const n = (Math.random() * 2 - 1)
      z = n * (1 - coef) + z * coef
      d[i] = z * env
    }
  }
  irCache.set(key, buf)
  return buf
}

const DIVS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6] // en temps (noires)
export const DIV_LABELS = ['1/16', '1/8', '1/8.', '1/4', '1/4.', '1/2', '3/4', '1/1', '3/2']

/* ------------------------------------------------------------------ */

export function buildFx(ctx: BaseAudioContext, slot: FxSlot, bpm: number): FxNode {
  const f = FACTORIES[slot.type]
  const node = f(ctx, slot, bpm)
  node.update(slot, bpm)
  return node
}

type Factory = (ctx: BaseAudioContext, slot: FxSlot, bpm: number) => FxNode
const FACTORIES: Record<FxType, Factory> = {

  /* ---------------- FILTRE + LFO ---------------- */
  filter: (ctx) => {
    const input = ctx.createGain(), output = ctx.createGain()
    const bq = ctx.createBiquadFilter()
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    lfo.type = 'sine'
    lfo.connect(lfoGain).connect(bq.frequency)
    lfo.start()
    input.connect(bq).connect(output)
    return {
      in: input, out: output,
      update(s) {
        bq.type = (['lowpass', 'highpass', 'bandpass'] as BiquadFilterType[])[clamp(Math.round(s.p.mode), 0, 2)]
        bq.frequency.value = clamp(s.p.freq, 30, 20000)
        bq.Q.value = clamp(s.p.q, 0.001, 30)
        lfo.frequency.value = clamp(s.p.lfo, 0.001, 20)
        lfoGain.gain.value = s.p.lfo > 0.01 ? s.p.freq * s.p.depth * 0.9 : 0
      },
      dispose() { try { lfo.stop() } catch { /* deja arrete */ } },
    }
  },

  /* ---------------- DELAY PING-PONG ---------------- */
  delay: (ctx) => {
    const input = ctx.createGain(), output = ctx.createGain()
    const dry = ctx.createGain(), wet = ctx.createGain()
    const splitL = ctx.createDelay(4), splitR = ctx.createDelay(4)
    const fbL = ctx.createGain(), fbR = ctx.createGain()
    const toneL = ctx.createBiquadFilter(), toneR = ctx.createBiquadFilter()
    toneL.type = toneR.type = 'lowpass'
    const merge = ctx.createChannelMerger(2)
    const panL = ctx.createGain(), panR = ctx.createGain()

    input.connect(dry).connect(output)
    input.connect(splitL)
    splitL.connect(toneL).connect(fbL)
    splitR.connect(toneR).connect(fbR)
    fbL.connect(splitR)   // ping
    fbR.connect(splitL)   // pong
    splitL.connect(panL).connect(merge, 0, 0)
    splitR.connect(panR).connect(merge, 0, 1)
    merge.connect(wet).connect(output)

    return {
      in: input, out: output,
      update(s, bpm) {
        const beat = 60 / Math.max(20, bpm)
        const d = DIVS[clamp(Math.round(s.p.time), 0, DIVS.length - 1)] * beat
        splitL.delayTime.value = clamp(d, 0.001, 4)
        splitR.delayTime.value = clamp(d * (s.p.ping > 0.5 ? 1 : 1.5), 0.001, 4)
        fbL.gain.value = fbR.gain.value = clamp(s.p.fb, 0, 0.94)
        toneL.frequency.value = toneR.frequency.value = clamp(s.p.tone, 100, 18000)
        panL.gain.value = panR.gain.value = 1
        wet.gain.value = s.wet
        dry.gain.value = 1
      },
    }
  },

  /* ---------------- REVERB A CONVOLUTION ---------------- */
  reverb: (ctx) => {
    const input = ctx.createGain(), output = ctx.createGain()
    const dry = ctx.createGain(), wet = ctx.createGain()
    const pre = ctx.createDelay(0.5)
    const conv = ctx.createConvolver()
    conv.normalize = true
    input.connect(dry).connect(output)
    input.connect(pre).connect(conv).connect(wet).connect(output)
    let lastKey = ''
    return {
      in: input, out: output,
      update(s) {
        const key = `${s.p.size.toFixed(2)}|${s.p.damp.toFixed(0)}`
        if (key !== lastKey) { conv.buffer = makeIR(ctx, s.p.size, s.p.damp); lastKey = key }
        pre.delayTime.value = clamp(s.p.pre, 0, 0.4)
        wet.gain.value = s.wet * 1.3
        dry.gain.value = 1
      },
    }
  },

  /* ---------------- BITCRUSHER ---------------- */
  crush: (ctx) => {
    const input = ctx.createGain(), output = ctx.createGain()
    const dry = ctx.createGain(), wet = ctx.createGain()
    input.connect(dry).connect(output)

    if (hasWorklet(ctx)) {
      const w = new AudioWorkletNode(ctx as BaseAudioContext & { audioWorklet: AudioWorklet }, 'vidaw-crusher', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      })
      input.connect(w).connect(wet).connect(output)
      return {
        in: input, out: output,
        update(s) {
          (w.parameters.get('bits') as AudioParam).value = clamp(s.p.bits, 1, 16)
          ;(w.parameters.get('down') as AudioParam).value = clamp(s.p.down, 1, 64)
          ;(w.parameters.get('noise') as AudioParam).value = clamp(s.p.noise, 0, 1)
          wet.gain.value = s.wet
          dry.gain.value = 1 - s.wet
        },
        dispose() { try { w.port.postMessage('kill') } catch { /* rien */ } },
      }
    }
    // Repli sans worklet : quantification d'amplitude au waveshaper
    const ws = ctx.createWaveShaper()
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'
    input.connect(ws).connect(lp).connect(wet).connect(output)
    let lastBits = -1
    return {
      in: input, out: output,
      update(s) {
        const bits = clamp(Math.round(s.p.bits), 1, 16)
        if (bits !== lastBits) {
          const levels = Math.pow(2, bits) - 1
          const n = 4096, c: F32 = new Float32Array(n)
          for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * 2 - 1
            c[i] = Math.round((x * 0.5 + 0.5) * levels) / levels * 2 - 1
          }
          ws.curve = c; lastBits = bits
        }
        lp.frequency.value = clamp(ctx.sampleRate / 2 / clamp(s.p.down, 1, 64), 200, 20000)
        wet.gain.value = s.wet
        dry.gain.value = 1 - s.wet
      },
    }
  },

  /* ---------------- DISTORSION ---------------- */
  dist: (ctx) => {
    const input = ctx.createGain(), output = ctx.createGain()
    const pre = ctx.createGain()
    const ws = ctx.createWaveShaper(); ws.oversample = '4x'
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'
    const post = ctx.createGain()
    const dry = ctx.createGain(), wet = ctx.createGain()
    input.connect(dry).connect(output)
    input.connect(pre).connect(ws).connect(tone).connect(post).connect(wet).connect(output)
    let key = ''
    return {
      in: input, out: output,
      update(s) {
        const k = `${s.p.drive.toFixed(2)}|${s.p.fold.toFixed(2)}`
        if (k !== key) { ws.curve = driveCurve(s.p.drive / 60, s.p.fold); key = k }
        pre.gain.value = 1 + s.p.drive * 0.12
        tone.frequency.value = clamp(s.p.tone, 200, 19000)
        post.gain.value = 1 / (1 + s.p.drive * 0.045)
        wet.gain.value = s.wet
        dry.gain.value = 1 - s.wet
      },
    }
  },

  /* ---------------- CHORUS ---------------- */
  chorus: (ctx) => {
    const input = ctx.createGain(), output = ctx.createGain()
    const dry = ctx.createGain(), wet = ctx.createGain()
    input.connect(dry).connect(output)
    const merge = ctx.createChannelMerger(2)
    const lfos: OscillatorNode[] = []
    const depths: GainNode[] = []
    for (let i = 0; i < 3; i++) {
      const dl = ctx.createDelay(0.1)
      dl.delayTime.value = 0.012 + i * 0.006
      const lfo = ctx.createOscillator()
      lfo.type = 'sine'
      lfo.frequency.value = 0.6 + i * 0.13
      const dg = ctx.createGain()
      lfo.connect(dg).connect(dl.delayTime)
      lfo.start(i * 0.13)
      const g = ctx.createGain(); g.gain.value = 0.45
      input.connect(dl).connect(g)
      g.connect(merge, 0, i % 2)
      lfos.push(lfo); depths.push(dg)
    }
    merge.connect(wet).connect(output)
    return {
      in: input, out: output,
      update(s) {
        lfos.forEach((l, i) => { l.frequency.value = clamp(s.p.rate * (1 + i * 0.21), 0.01, 20) })
        depths.forEach((d) => { d.gain.value = clamp(s.p.depth, 0, 0.05) })
        wet.gain.value = s.wet * (0.6 + s.p.spread * 0.6)
        dry.gain.value = 1
      },
      dispose() { lfos.forEach((l) => { try { l.stop() } catch { /* deja arrete */ } }) },
    }
  },

  /* ---------------- PHASER ---------------- */
  phaser: (ctx) => {
    const input = ctx.createGain(), output = ctx.createGain()
    const dry = ctx.createGain(), wet = ctx.createGain()
    const fb = ctx.createGain()
    const stages: BiquadFilterNode[] = []
    let node: AudioNode = input
    for (let i = 0; i < 6; i++) {
      const ap = ctx.createBiquadFilter()
      ap.type = 'allpass'
      ap.frequency.value = 400 + i * 300
      ap.Q.value = 0.8
      node.connect(ap)
      node = ap
      stages.push(ap)
    }
    const lfo = ctx.createOscillator(); lfo.type = 'sine'
    const lfoG = ctx.createGain()
    stages.forEach((s) => lfoG.connect(s.frequency))
    lfo.connect(lfoG); lfo.start()
    node.connect(fb).connect(stages[0])
    node.connect(wet).connect(output)
    input.connect(dry).connect(output)
    return {
      in: input, out: output,
      update(s) {
        lfo.frequency.value = clamp(s.p.rate, 0.01, 20)
        lfoG.gain.value = 900 * clamp(s.p.depth, 0, 1)
        fb.gain.value = clamp(s.p.fb, 0, 0.85)
        wet.gain.value = s.wet
        dry.gain.value = 1
      },
      dispose() { try { lfo.stop() } catch { /* deja arrete */ } },
    }
  },

  /* ---------------- EQ 3 BANDES ---------------- */
  eq3: (ctx) => {
    const input = ctx.createGain(), output = ctx.createGain()
    const lo = ctx.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 220
    const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1400; mid.Q.value = 0.9
    const hi = ctx.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = 5200
    input.connect(lo).connect(mid).connect(hi).connect(output)
    return {
      in: input, out: output,
      update(s) {
        lo.gain.value = clamp(s.p.low, -30, 24)
        mid.gain.value = clamp(s.p.mid, -30, 24)
        hi.gain.value = clamp(s.p.high, -30, 24)
      },
    }
  },

  /* ---------------- COMPRESSEUR ---------------- */
  comp: (ctx) => {
    const input = ctx.createGain(), output = ctx.createGain()
    const c = ctx.createDynamicsCompressor()
    const makeup = ctx.createGain()
    input.connect(c).connect(makeup).connect(output)
    return {
      in: input, out: output,
      update(s) {
        c.threshold.value = clamp(s.p.thr, -100, 0)
        c.ratio.value = clamp(s.p.ratio, 1, 20)
        c.attack.value = clamp(s.p.atk, 0, 1)
        c.release.value = clamp(s.p.rel, 0.01, 1)
        c.knee.value = 6
        makeup.gain.value = clamp(s.p.makeup, 0, 4)
      },
    }
  },

  /* ---------------- TRANCE GATE ---------------- */
  gate: (ctx) => {
    const input = ctx.createGain(), output = ctx.createGain()
    const vca = ctx.createGain()
    vca.gain.value = 1
    const lfo = ctx.createOscillator()
    const shaper = ctx.createWaveShaper()
    const depth = ctx.createGain()
    const offset = ctx.createConstantSource()
    offset.offset.value = 1
    lfo.type = 'sawtooth'
    lfo.connect(shaper).connect(depth)
    depth.connect(vca.gain)
    offset.connect(vca.gain)
    lfo.start(); offset.start()
    input.connect(vca).connect(output)
    let lastShape = -1
    return {
      in: input, out: output,
      update(s, bpm) {
        const div = [1, 2, 4, 8, 16][clamp(Math.round(s.p.rate), 0, 4)]
        lfo.frequency.value = clamp((bpm / 60) * div / 2, 0.05, 60)
        const sh = Math.round(s.p.shape * 20)
        if (sh !== lastShape) {
          const n = 1024, c: F32 = new Float32Array(n)
          const hard = s.p.shape
          for (let i = 0; i < n; i++) {
            const x = i / (n - 1)                    // 0..1 rampe
            const pulse = x < 0.5 ? 1 : 0
            const smooth = 0.5 - 0.5 * Math.cos(x * Math.PI * 2)
            c[i] = -(1 - (pulse * hard + smooth * (1 - hard)))  // 0 -> -1
          }
          shaper.curve = c; lastShape = sh
        }
        depth.gain.value = clamp(s.p.depth, 0, 1)
      },
      dispose() {
        try { lfo.stop(); offset.stop() } catch { /* deja arrete */ }
      },
    }
  },
}

/* Petit utilitaire : bruit de fond "vinyle" pour le master, tres Y2K */
export function vinylNoise(ctx: BaseAudioContext, dest: AudioNode, level: number): { gain: GainNode; stop(): void } {
  const s = ctx.createBufferSource()
  s.buffer = noiseBuffer(ctx); s.loop = true
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000
  const g = ctx.createGain(); g.gain.value = level
  s.connect(hp).connect(lp).connect(g).connect(dest)
  s.start()
  return { gain: g, stop() { try { s.stop() } catch { /* deja arrete */ } } }
}
