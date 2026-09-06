/* ============================================================
   DJ ViDAW — IDENTITE

   Un seul endroit ecrit le nom du logiciel, et un seul dessin le
   represente. Avant, « DJ ViDAW » existait en six versions : un SVG
   dans la barre du haut, du WordArt dore dans « A propos », du texte
   chrome dans le mixeur, un autre traitement au demarrage... Une
   marque qui change de forme a chaque ecran n'est plus une marque.

   Deux objets, deux roles :
     · le LOGOTYPE  — le produit. Disque + DJ ViDAW.
     · la SIGNATURE — l'auteur. DJ Viteau, en un seul traitement.
   ============================================================ */

export const BRAND = {
  /** Le nom du logiciel. Cette casse et pas une autre. */
  name: 'DJ ViDAW',
  /** L'auteur. Cette casse et pas une autre. */
  author: 'DJ Viteau',
  tagline: 'STATION AUDIONUMERIQUE',
  version: '1.0',
  build: '2001.09.06',
  editor: 'Viteau Systems',
} as const

/* Les couleurs de la marque. Elles ne dependent pas du theme d'une
   fenetre : un logo qui change de couleur selon le fond n'en est plus un. */
const INK = '#0a1424'
const PINK = '#ff5cb0'

/** Compteur d'instances : deux logos sur la meme page partageraient
    leurs degrades si les identifiants etaient fixes. */
let seq = 0

export interface MarkOpts {
  /** Hauteur en pixels. La largeur suit. */
  h?: number
  /** Affiche la ligne « STATION AUDIONUMERIQUE ». */
  tagline?: boolean
  /** Fait tourner le disque et scintiller l'etoile. */
  animate?: boolean
}

const FACE = `'Trebuchet MS', 'DejaVu Sans', Verdana, Impact, sans-serif`

/* Deux mots, un seul dessin : le contour noir tient le tout, l'ombre
   portee le decolle, et textLength fige la largeur — la police de repli
   change d'une machine a l'autre, le logotype non. */
function word(x: number, y: number, size: number, len: number, txt: string, fill: string) {
  return `
    <text x="${x}" y="${y}" font-size="${size}" textLength="${len}" lengthAdjust="spacingAndGlyphs"
          fill="#000" opacity=".42" transform="translate(2,2.5)">${txt}</text>
    <text x="${x}" y="${y}" font-size="${size}" textLength="${len}" lengthAdjust="spacingAndGlyphs"
          fill="${fill}" stroke="${INK}" stroke-width="3" stroke-linejoin="round">${txt}</text>`
}

/** Le disque seul : favicon, ecran de veille, pastilles. */
export function discMark(size = 40, animate = false): string {
  const id = `dm${++seq}`
  return `<svg class="brand-disc" width="${size}" height="${size}" viewBox="0 0 40 40" fill="none" aria-hidden="true">
  <defs><radialGradient id="${id}" cx=".36" cy=".3" r=".85">
    <stop offset="0" stop-color="#f6f8fb"/><stop offset=".45" stop-color="#aeb6c4"/><stop offset="1" stop-color="#5e6675"/>
  </radialGradient></defs>
  <g${animate ? ' class="brand-spin"' : ''} style="transform-origin:20px 20px">
    <circle cx="20" cy="20" r="18" fill="url(#${id})" stroke="#0d1220" stroke-width="1.6"/>
    <path d="M20 2 a18 18 0 0 1 15.6 9.1 l-10.6 6 a5.8 5.8 0 0 0-5-2.9 Z" fill="#5fe6ff" opacity=".7"/>
    <path d="M20 38 a18 18 0 0 1-15.6-9.1 l10.6-6 a5.8 5.8 0 0 0 5 2.9 Z" fill="${PINK}" opacity=".55"/>
    <circle cx="20" cy="20" r="13" fill="none" stroke="rgba(0,0,0,.22)" stroke-width=".8"/>
    <circle cx="20" cy="20" r="9" fill="none" stroke="rgba(0,0,0,.22)" stroke-width=".8"/>
    <circle cx="20" cy="20" r="4.8" fill="#e9edf3" stroke="#0d1220" stroke-width="1.4"/>
    <circle cx="20" cy="20" r="1.6" fill="#0d1220"/>
  </g>
</svg>`
}

/**
 * Le logotype du produit. Un dessin, decline en taille — jamais
 * redessine ailleurs.
 */
export function wordmark(o: MarkOpts = {}): string {
  const tagline = o.tagline ?? true
  const H = o.h ?? 48
  const VB_H = tagline ? 48 : 40
  const VB_W = 192
  const w = Math.round((H / VB_H) * VB_W)
  const id = `bm${++seq}`
  const spin = o.animate !== false

  return `<svg class="brand-mark" width="${w}" height="${H}" viewBox="0 0 ${VB_W} ${VB_H}"
     fill="none" role="img" aria-label="${BRAND.name}">
  <defs>
    <linearGradient id="${id}-c" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"    stop-color="#ffffff"/>
      <stop offset=".26"  stop-color="#d3e3f7"/>
      <stop offset=".47"  stop-color="#7995ba"/>
      <stop offset=".505" stop-color="#1d3350"/>
      <stop offset=".545" stop-color="#c2d9f0"/>
      <stop offset=".78"  stop-color="#ffffff"/>
      <stop offset="1"    stop-color="#8aa9cd"/>
    </linearGradient>
    <linearGradient id="${id}-p" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"   stop-color="#ffd7ef"/>
      <stop offset=".42" stop-color="${PINK}"/>
      <stop offset=".52" stop-color="#c9147a"/>
      <stop offset="1"   stop-color="#ff8fd0"/>
    </linearGradient>
    <radialGradient id="${id}-d" cx=".36" cy=".3" r=".85">
      <stop offset="0"   stop-color="#f6f8fb"/>
      <stop offset=".45" stop-color="#aeb6c4"/>
      <stop offset="1"   stop-color="#5e6675"/>
    </radialGradient>
  </defs>

  <g${spin ? ' class="brand-spin"' : ''} style="transform-origin:20px 24px">
    <circle cx="20" cy="24" r="16" fill="url(#${id}-d)" stroke="#0d1220" stroke-width="1.6"/>
    <path d="M20 8 a16 16 0 0 1 13.9 8.1 l-9.4 5.3 a5.4 5.4 0 0 0-4.5-2.6 Z" fill="#5fe6ff" opacity=".7"/>
    <path d="M20 40 a16 16 0 0 1-13.9-8.1 l9.4-5.3 a5.4 5.4 0 0 0 4.5 2.6 Z" fill="${PINK}" opacity=".55"/>
    <circle cx="20" cy="24" r="11.5" fill="none" stroke="rgba(0,0,0,.22)" stroke-width=".8"/>
    <circle cx="20" cy="24" r="8" fill="none" stroke="rgba(0,0,0,.22)" stroke-width=".8"/>
    <circle cx="20" cy="24" r="4.2" fill="#e9edf3" stroke="#0d1220" stroke-width="1.4"/>
    <circle cx="20" cy="24" r="1.4" fill="#0d1220"/>
  </g>

  <g font-family="${FACE}" font-weight="900" paint-order="stroke fill">
    <g transform="rotate(-5 56 24)">${word(42, 31, 27, 30, 'DJ', `url(#${id}-p)`)}</g>
    ${word(76, 32, 30, 98, 'ViDAW', `url(#${id}-c)`)}
  </g>
  ${tagline ? `<text x="77" y="43" font-family="${FACE}" font-size="6" font-weight="700"
        letter-spacing=".4" textLength="96" lengthAdjust="spacing" fill="#93abca">${BRAND.tagline}</text>` : ''}

  <path class="${spin ? 'brand-spark' : ''}" style="transform-origin:181px 14px"
        d="M180 8 l1.5 4.6 4.6 1.5 -4.6 1.5 -1.5 4.6 -1.5-4.6 -4.6-1.5 4.6-1.5 Z"
        fill="#fff8c9" stroke="#c9a227" stroke-width=".7" stroke-linejoin="round"/>
</svg>`
}

/**
 * La signature de l'auteur. Volontairement differente du logotype :
 * un tampon plat et rose, sans chrome. On ne confond pas le nom du
 * logiciel avec celui de la personne qui l'a fait.
 */
export function signature(h = 20): string {
  const VB_W = 128, VB_H = 22
  const w = Math.round((h / VB_H) * VB_W)
  const id = `sg${++seq}`
  return `<svg class="brand-sign" width="${w}" height="${h}" viewBox="0 0 ${VB_W} ${VB_H}"
     fill="none" role="img" aria-label="${BRAND.author}">
  <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffd7ef"/><stop offset=".55" stop-color="${PINK}"/><stop offset="1" stop-color="#b8156e"/>
  </linearGradient></defs>
  <path d="M4 4 l2 5 5 2 -5 2 -2 5 -2-5 -5-2 5-2 Z" fill="#fff8c9" stroke="#c9a227" stroke-width=".7" stroke-linejoin="round"/>
  <text x="17" y="17" font-family="${FACE}" font-size="16" font-weight="900" font-style="italic"
        textLength="108" lengthAdjust="spacingAndGlyphs"
        fill="url(#${id})" stroke="#2a0a1c" stroke-width="2.4" stroke-linejoin="round"
        paint-order="stroke fill">${BRAND.author}</text>
</svg>`
}

/** Le logotype pret a inserer dans le DOM. */
export function markEl(o: MarkOpts = {}): HTMLElement {
  const el = document.createElement('span')
  el.className = 'brand'
  el.innerHTML = wordmark(o)
  return el
}

/** La signature prete a inserer dans le DOM. */
export function signEl(h = 20): HTMLElement {
  const el = document.createElement('span')
  el.className = 'brand'
  el.innerHTML = signature(h)
  return el
}
