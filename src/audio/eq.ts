/* ============================================================
   DJ ViDAW — EGALISEUR PARAMETRIQUE

   Un EQ utilisable partout : la Nightcorification et les platines
   s'en servent. Deux choses ici :

   1. La chaine audio (des BiquadFilterNode en serie).
   2. Les memes filtres en formules, pour tracer la courbe SANS
      contexte audio. getFrequencyResponse aurait suffi, mais il
      exige un noeud vivant : impossible de dessiner l'EQ avant que
      l'utilisateur ait autorise le son. Les coefficients sont ceux
      de la specification Web Audio (cookbook RBJ), donc la courbe
      dessinee est exactement celle qu'on entend.
   ============================================================ */

import { clamp } from '../core/state'

export type BandType = 'lowshelf' | 'peaking' | 'highshelf' | 'highpass' | 'lowpass'

export interface EqBand {
  type: BandType
  f: number    // Hz
  g: number    // dB (ignore pour highpass / lowpass)
  q: number
  on: boolean
}

export const EQ_MIN_DB = -18
export const EQ_MAX_DB = 18

/** Les cinq bandes de depart : deux plateaux, trois cloches.
    Les frequences ne sont pas prises au hasard : 250 Hz est la zone de
    boue, 1,5 kHz celle ou vit la voix, 5 kHz celle de la clarte. */
export function defaultEq(): EqBand[] {
  return [
    { type: 'lowshelf', f: 110, g: 0, q: 0.7, on: true },
    { type: 'peaking', f: 260, g: 0, q: 1.1, on: true },
    { type: 'peaking', f: 1500, g: 0, q: 0.9, on: true },
    { type: 'peaking', f: 5000, g: 0, q: 1, on: true },
    { type: 'highshelf', f: 8000, g: 0, q: 0.7, on: true },
  ]
}

export const BAND_NAMES = ['GRAVE', 'BOUE', 'CORPS', 'CLARTE', 'AIR']

export interface EqPreset { name: string; tag: string; bands: number[] }

/** Chaque preset ne donne que les gains : les frequences restent celles
    que l'utilisateur a reglees, sinon un preset ecraserait son travail. */
export const EQ_PRESETS: EqPreset[] = [
  { name: 'PLAT', tag: 'on repart de zero', bands: [0, 0, 0, 0, 0] },
  { name: 'GRAVE COLOSSAL', tag: '+8 dB sous 110 Hz', bands: [8, -1.5, 0, 0, 1] },
  { name: 'ANTI-BOUE', tag: 'degage le bas-medium', bands: [2, -6, 0, 1.5, 2] },
  { name: 'CA RESPIRE', tag: 'creuse et ouvre', bands: [3, -3.5, -1.5, 2, 4] },
  { name: 'VOIX DEVANT', tag: 'la voix passe au-dessus', bands: [-1, -2.5, 4, 2.5, 1.5] },
  { name: 'TELEPHONE', tag: 'tout dans le medium', bands: [-14, 3, 6, 2, -12] },
  { name: 'CLUB', tag: 'sourire, grave et aigu', bands: [5.5, -2, -2, 1.5, 4.5] },
]

/* ------------------------------------------------------------------ */
/* La chaine audio                                                     */
/* ------------------------------------------------------------------ */

export interface EqChain {
  input: AudioNode
  output: AudioNode
  update(bands: EqBand[]): void
}

export function buildEq(ctx: BaseAudioContext, bands: EqBand[]): EqChain {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const nodes = bands.map(() => ctx.createBiquadFilter())

  let prev: AudioNode = input
  for (const n of nodes) { prev.connect(n); prev = n }
  prev.connect(output)

  const chain: EqChain = {
    input, output,
    update(bs) {
      bs.forEach((b, i) => {
        const n = nodes[i]
        if (!n) return
        n.type = b.type
        n.frequency.value = clamp(b.f, 20, 20000)
        n.Q.value = clamp(b.q, 0.05, 20)
        // Desactiver une bande, c'est la mettre a plat : couper le noeud
        // ferait un trou dans le graphe et un clic a chaque bascule.
        n.gain.value = b.on ? clamp(b.g, EQ_MIN_DB, EQ_MAX_DB) : 0
        if (!b.on && (b.type === 'highpass' || b.type === 'lowpass')) {
          n.frequency.value = b.type === 'highpass' ? 20 : 20000
        }
      })
    },
  }
  chain.update(bands)
  return chain
}

/* ------------------------------------------------------------------ */
/* Les memes filtres, en formules                                      */
/* ------------------------------------------------------------------ */

type Coefs = [number, number, number, number, number] // b0 b1 b2 a1 a2, normalises

function coefs(b: EqBand, fs: number): Coefs {
  const f0 = clamp(b.f, 10, fs * 0.49)
  const q = clamp(b.q, 0.05, 20)
  const w0 = (2 * Math.PI * f0) / fs
  const cw = Math.cos(w0), sw = Math.sin(w0)
  const A = Math.pow(10, clamp(b.g, EQ_MIN_DB, EQ_MAX_DB) / 40)

  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0
  if (b.type === 'peaking') {
    const al = sw / (2 * q)
    b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A
    a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A
  } else if (b.type === 'lowshelf' || b.type === 'highshelf') {
    // Web Audio impose S = 1 pour les plateaux : Q y est ignore.
    const al = (sw / 2) * Math.SQRT2
    const sa = 2 * Math.sqrt(A) * al
    if (b.type === 'lowshelf') {
      b0 = A * ((A + 1) - (A - 1) * cw + sa)
      b1 = 2 * A * ((A - 1) - (A + 1) * cw)
      b2 = A * ((A + 1) - (A - 1) * cw - sa)
      a0 = (A + 1) + (A - 1) * cw + sa
      a1 = -2 * ((A - 1) + (A + 1) * cw)
      a2 = (A + 1) + (A - 1) * cw - sa
    } else {
      b0 = A * ((A + 1) + (A - 1) * cw + sa)
      b1 = -2 * A * ((A - 1) + (A + 1) * cw)
      b2 = A * ((A + 1) + (A - 1) * cw - sa)
      a0 = (A + 1) - (A - 1) * cw + sa
      a1 = 2 * ((A - 1) - (A + 1) * cw)
      a2 = (A + 1) - (A - 1) * cw - sa
    }
  } else {
    const al = sw / (2 * q)
    if (b.type === 'highpass') {
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2
    } else {
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2
    }
    a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0]
}

/** Module de H(e^jw) en dB pour une bande, a une frequence donnee. */
function bandDb(c: Coefs, f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs
  const c1 = Math.cos(w), s1 = Math.sin(w)
  const c2 = Math.cos(2 * w), s2 = Math.sin(2 * w)
  // z^-1 = cos w - j sin w
  const nr = c[0] + c[1] * c1 + c[2] * c2
  const ni = -(c[1] * s1 + c[2] * s2)
  const dr = 1 + c[3] * c1 + c[4] * c2
  const di = -(c[3] * s1 + c[4] * s2)
  const num = Math.hypot(nr, ni)
  const den = Math.hypot(dr, di) || 1e-9
  return 20 * Math.log10(Math.max(1e-9, num / den))
}

/** Reponse totale de l'egaliseur, en dB, aux frequences demandees. */
export function eqResponse(bands: EqBand[], freqs: ArrayLike<number>, fs = 48000): Float32Array {
  const out = new Float32Array(freqs.length)
  for (const b of bands) {
    if (!b.on || (b.type !== 'highpass' && b.type !== 'lowpass' && Math.abs(b.g) < 0.01)) continue
    const c = coefs(b, fs)
    for (let i = 0; i < freqs.length; i++) out[i] += bandDb(c, freqs[i], fs)
  }
  return out
}

/** Compensation de niveau : la moyenne de la courbe, en dB, sur la bande
    utile. Booster les graves ne doit pas simplement « faire plus fort »,
    sinon toute comparaison avant/apres est faussee. */
export function eqAutoGain(bands: EqBand[], fs = 48000): number {
  const n = 96
  const freqs = new Float32Array(n)
  for (let i = 0; i < n; i++) freqs[i] = 30 * Math.pow(16000 / 30, i / (n - 1))
  const r = eqResponse(bands, freqs, fs)
  let s = 0
  // ponderation grossiere facon courbe d'egale sensation : l'oreille
  // compte le medium plus que les extremes
  let wsum = 0
  for (let i = 0; i < n; i++) {
    const f = freqs[i]
    const w = f < 120 ? 0.45 : f > 9000 ? 0.5 : 1
    s += r[i] * w; wsum += w
  }
  return -(s / wsum)
}

/** Les frequences d'affichage de la courbe, en echelle logarithmique. */
export function eqFreqAxis(n: number, lo = 20, hi = 20000): Float32Array {
  const f = new Float32Array(n)
  for (let i = 0; i < n; i++) f[i] = lo * Math.pow(hi / lo, i / (n - 1))
  return f
}
