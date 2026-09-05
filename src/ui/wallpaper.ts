/* ============================================================
   DJ ViDAW — FOND D'ECRAN
   Un paysage calcule : ciel degrade, nuages en bruit fractionnaire,
   collines herbeuses texturees, brume d'horizon et grain.
   Rendu une fois au demarrage dans un canevas basse definition
   puis etire — les formes sont douces, l'interpolation ne se voit pas.
   ============================================================ */

/* --- Bruit de valeur, interpole en douceur --------------------------- */
function hash2(x: number, y: number, seed: number): number {
  // Math.imul pour un vrai produit 32 bits, et des decalages NON signes :
  // avec ">>", le sign-extend force le bit 31 a zero et le hash plafonne a 0.5.
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967295
}
const smooth = (t: number) => t * t * (3 - 2 * t)

function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = smooth(x - xi), yf = smooth(y - yi)
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed)
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed)
  return (a + (b - a) * xf) + ((c + (d - c) * xf) - (a + (b - a) * xf)) * yf
}

function fbm(x: number, y: number, octaves: number, seed: number, lac = 2.03, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, fx = x, fy = y
  for (let i = 0; i < octaves; i++) {
    sum += noise2(fx, fy, seed + i * 131) * amp
    norm += amp
    amp *= gain
    fx *= lac; fy *= lac
  }
  return sum / norm
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const sat = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const step = (e0: number, e1: number, v: number) => sat((v - e0) / (e1 - e0 || 1e-6))

/* --- La scene -------------------------------------------------------- */

export interface WallpaperOpts {
  seed?: number
  width?: number
  height?: number
  /** URL ou data: URI d'une photo. Fournie, elle remplace le rendu calcule —
      c'est le point d'accroche pour brancher un vrai fond d'ecran. */
  photo?: string
}

/* Deux cretes, en fraction de hauteur (y croit vers le bas).
   La colline proche domine le bas du cadre ; la lointaine ne depasse
   que la ou elle passe AU-DESSUS de la proche, sinon elle est masquee. */
function ridgeNear(u: number, seed: number): number {
  const bump = 0.155 * Math.exp(-Math.pow((u - 0.28) / 0.40, 2))
  const right = 0.048 * Math.exp(-Math.pow((u - 0.97) / 0.26, 2))
  const roll = (fbm(u * 2.4 + 3, 4.2, 3, seed) - 0.5) * 0.030
  return 0.585 - bump - right + roll
}
function ridgeFar(u: number, seed: number): number {
  const crest = 0.095 * Math.exp(-Math.pow((u - 0.80) / 0.30, 2))
  const roll = (fbm(u * 3.6 + 11, 9.1, 3, seed) - 0.5) * 0.022
  return 0.505 - crest + roll
}

export function renderWallpaper(canvas: HTMLCanvasElement, o: WallpaperOpts = {}) {
  const seed = o.seed ?? 7
  const W = o.width ?? 1400
  const H = o.height ?? 880
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')
  if (!g) return
  const img = g.createImageData(W, H)
  const d = img.data

  const skyTop = [20, 70, 165], skyMid = [56, 130, 214], skyLow = [148, 205, 240], skyHaze = [222, 240, 250]
  const grassLit = [138, 206, 82], grassMid = [92, 172, 50], grassDeep = [44, 108, 26]
  const farHill = [126, 178, 122]

  // cretes pre-calculees, une valeur par colonne
  const near = new Float32Array(W), far = new Float32Array(W)
  for (let x = 0; x < W; x++) {
    const u = x / W
    near[x] = ridgeNear(u, seed) * H
    far[x] = ridgeFar(u, seed) * H
  }

  /* --- teinte du ciel a une hauteur donnee, nuages compris --- */
  const sky = (u: number, v: number, out: number[]) => {
    const t = sat(v / 0.62)
    let r: number, gg: number, b: number
    if (t < 0.45) {
      const k = t / 0.45
      r = lerp(skyTop[0], skyMid[0], k); gg = lerp(skyTop[1], skyMid[1], k); b = lerp(skyTop[2], skyMid[2], k)
    } else if (t < 0.84) {
      const k = (t - 0.45) / 0.39
      r = lerp(skyMid[0], skyLow[0], k); gg = lerp(skyMid[1], skyLow[1], k); b = lerp(skyMid[2], skyLow[2], k)
    } else {
      const k = (t - 0.84) / 0.16
      r = lerp(skyLow[0], skyHaze[0], k); gg = lerp(skyLow[1], skyHaze[1], k); b = lerp(skyLow[2], skyHaze[2], k)
    }

    // halo solaire, haut a droite
    const sx = u - 0.82, sy = v - 0.02
    const sun = Math.exp(-(sx * sx * 2.6 + sy * sy * 9) * 4.4) * 0.6
    r += sun * 95; gg += sun * 84; b += sun * 52

    /* Nuages. En perspective, ceux qui sont pres de l'horizon se repetent
       davantage et s'aplatissent : le facteur croit avec v. */
    const persp = 0.62 + v * 3.4
    const cx = u * 2.9 * persp
    const cy = v * 7.6 * persp
    const fade = sat((0.50 - v) / 0.22)          // rien de gros colle a l'horizon
    if (fade > 0.004) {
      const puff = fbm(cx + 1.5, cy + 0.7, 5, seed + 90)
      const veil = fbm(cx * 0.5 + 4, cy * 0.45 + 2, 4, seed + 40)
      let cover = step(0.575, 0.715, puff)
      cover = Math.max(cover, step(0.545, 0.690, veil) * 0.30)
      cover *= fade
      if (cover > 0.004) {
        // le sommet du nuage prend le soleil, le dessous reste gris-bleu
        const above = fbm(cx + 1.5, cy + 0.7 - 0.22, 5, seed + 90)
        const lit = sat((puff - above) * 6 + 0.5)
        const cr = lerp(188, 255, lit), cg = lerp(197, 255, lit), cb = lerp(212, 255, lit)
        r = lerp(r, cr, cover); gg = lerp(gg, cg, cover); b = lerp(b, cb, cover)
      }
    }
    out[0] = r; out[1] = gg; out[2] = b
  }

  /* --- colline lointaine, noyee de brume --- */
  const distant = (u: number, v: number, y: number, x: number, out: number[]) => {
    const depth = sat((y - far[x]) / (H * 0.09))
    const tex = (fbm(u * 30, v * 30, 3, seed + 5) - 0.5) * 0.18
    let r = farHill[0] * (1 + tex), gg = farHill[1] * (1 + tex), b = farHill[2] * (1 + tex)
    const haze = (1 - depth) * 0.6
    r = lerp(r, 210, haze); gg = lerp(gg, 228, haze); b = lerp(b, 240, haze)
    out[0] = r; out[1] = gg; out[2] = b
  }

  /* --- colline principale --- */
  const meadow = (u: number, y: number, x: number, out: number[]) => {
    const below = (y - near[x]) / H
    const slope = (near[Math.min(W - 1, x + 4)] - near[Math.max(0, x - 4)]) / 8

    const k = sat(below / 0.36)
    let r: number, gg: number, b: number
    if (k < 0.40) {
      const t = k / 0.40
      r = lerp(grassLit[0], grassMid[0], t); gg = lerp(grassLit[1], grassMid[1], t); b = lerp(grassLit[2], grassMid[2], t)
    } else {
      const t = (k - 0.40) / 0.60
      r = lerp(grassMid[0], grassDeep[0], t); gg = lerp(grassMid[1], grassDeep[1], t); b = lerp(grassMid[2], grassDeep[2], t)
    }

    // eclairage directionnel : la pente qui monte vers la droite recoit le soleil
    const light = 1 + sat(-slope * 1.5) * 0.15 - sat(slope * 1.5) * 0.13
    // moutonnement de l'herbe : grandes plaques, puis grain fin qui ne porte
    // qu'au premier plan
    const nearness = sat(below / 0.26)
    const patch = fbm(u * 7 + 3, below * 13, 4, seed + 12) - 0.5
    const grass = (fbm(u * 44, below * 96, 3, seed + 33) - 0.5) * (0.35 + nearness * 0.65)
    const tex = 1 + patch * 0.24 + grass * 0.17
    // les plaques les plus claires tirent vers le jaune, comme de l'herbe seche
    const dry = sat(patch * 2.2) * 0.5
    // liseré lumineux juste sous la crete
    const rim = Math.exp(-below * 110) * 0.32

    r = r * light * tex + dry * 26 + rim * 130
    gg = gg * light * tex + dry * 20 + rim * 158
    b = b * light * tex - dry * 10 + rim * 74
    out[0] = r; out[1] = gg; out[2] = b
  }

  const a: number[] = [0, 0, 0], bcol: number[] = [0, 0, 0]

  for (let y = 0; y < H; y++) {
    const v = y / H
    for (let x = 0; x < W; x++) {
      const u = x / W
      const skyEnd = Math.min(far[x], near[x])
      let r: number, gg: number, b: number

      if (y < skyEnd - 1) {
        sky(u, v, a); r = a[0]; gg = a[1]; b = a[2]
      } else if (y < near[x] - 1) {
        // bande de colline lointaine, avec un fondu de 1 px sur son arete
        if (y < skyEnd + 1) {
          sky(u, v, a); distant(u, v, y, x, bcol)
          const m = sat(y - (skyEnd - 1) === 0 ? 0 : (y - skyEnd + 1) / 2)
          r = lerp(a[0], bcol[0], m); gg = lerp(a[1], bcol[1], m); b = lerp(a[2], bcol[2], m)
        } else {
          distant(u, v, y, x, a); r = a[0]; gg = a[1]; b = a[2]
        }
      } else if (y < near[x] + 1) {
        // arete de la colline principale : anticrenelage sur 2 px
        if (near[x] <= skyEnd) sky(u, v, a)
        else distant(u, v, y, x, a)
        meadow(u, y, x, bcol)
        const m = sat((y - near[x] + 1) / 2)
        r = lerp(a[0], bcol[0], m); gg = lerp(a[1], bcol[1], m); b = lerp(a[2], bcol[2], m)
      } else {
        meadow(u, y, x, a); r = a[0]; gg = a[1]; b = a[2]
      }

      // vignettage discret
      const vx = (u - 0.5) * 2, vy = (v - 0.5) * 2
      const vig = 1 - sat(Math.sqrt(vx * vx + vy * vy) - 0.75) * 0.28
      r *= vig; gg *= vig; b *= vig

      // grain argentique
      const grain = (hash2(x, y, seed + 777) - 0.5) * 6
      const i = (y * W + x) * 4
      d[i] = sat((r + grain) / 255) * 255
      d[i + 1] = sat((gg + grain) / 255) * 255
      d[i + 2] = sat((b + grain) / 255) * 255
      d[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
}

/** Installe le fond dans un conteneur. Rendu une seule fois : la scene est
    fixe, il n'y a rien a recalculer au redimensionnement. */
export function installWallpaper(host: HTMLElement, opts: WallpaperOpts = {}): HTMLElement {
  if (opts.photo) {
    const el = document.createElement('div')
    el.className = 'wallpaper wallpaper-photo'
    el.style.backgroundImage = `url("${opts.photo}")`
    host.insertBefore(el, host.firstChild)
    return el
  }
  const cv = document.createElement('canvas')
  cv.className = 'wallpaper'
  host.insertBefore(cv, host.firstChild)
  renderWallpaper(cv, opts)
  return cv
}
