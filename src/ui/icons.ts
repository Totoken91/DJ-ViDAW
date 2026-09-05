/* ============================================================
   DJ ViDAW — JEU D'ICONES
   Dessinees sur une grille de 16, en aplats cernes : c'est la
   grammaire des icones de 2001. Les emoji n'existaient pas encore,
   et ils cassent l'illusion plus surement que n'importe quel detail.
   ============================================================ */

const INK = '#171720'
const STEEL = '#aab2c0'
const STEEL_D = '#6e7788'
const BLUE = '#2f6fd0'
const BLUE_L = '#7fb6f2'
const YEL = '#ffc93c'
const YEL_D = '#c98f00'
const GRN = '#3fca55'
const RED = '#e03a2f'
const PINK = '#ff4fa3'
const CYAN = '#4fe9ff'
const PAPER = '#f4f3ed'

const o = (extra = '') => `stroke="${INK}" stroke-width="1" ${extra}`

/* Chaque entree renvoie le contenu d'un <svg viewBox="0 0 16 16">. */
const SHAPES: Record<string, string> = {

  /* ---- transport ---- */
  play: `<path d="M4.5 3 L13 8 L4.5 13 Z" fill="${GRN}" ${o('stroke-linejoin="round"')}/>`,
  pause: `<rect x="4" y="3.5" width="3" height="9" fill="${YEL}" ${o()}/><rect x="9" y="3.5" width="3" height="9" fill="${YEL}" ${o()}/>`,
  stop: `<rect x="4" y="4" width="8" height="8" fill="${STEEL}" ${o()}/>`,
  rec: `<circle cx="8" cy="8" r="4.5" fill="${RED}" ${o()}/><circle cx="6.5" cy="6.5" r="1.2" fill="#ff9c93"/>`,
  song: `<path d="M2.5 3 L8 8 L2.5 13 Z" fill="${GRN}" ${o('stroke-linejoin="round"')}/><path d="M8 3 L13.5 8 L8 13 Z" fill="${GRN}" ${o('stroke-linejoin="round"')}/>`,
  loop: `<path d="M4 5.5 h6 v-2 l3 3 -3 3 v-2 H5.5 v3 H4 Z" fill="${CYAN}" ${o('stroke-linejoin="round"')}/>`,

  /* ---- fenetres ---- */
  rack: `<rect x="1.5" y="3.5" width="13" height="9" rx="1" fill="${STEEL_D}" ${o()}/>
    <rect x="3" y="5" width="2.5" height="2.5" fill="${YEL}"/><rect x="6.5" y="5" width="2.5" height="2.5" fill="${PINK}"/><rect x="10" y="5" width="2.5" height="2.5" fill="${CYAN}"/>
    <rect x="3" y="8.5" width="2.5" height="2.5" fill="#3c4250"/><rect x="6.5" y="8.5" width="2.5" height="2.5" fill="${YEL}"/><rect x="10" y="8.5" width="2.5" height="2.5" fill="#3c4250"/>`,
  piano: `<rect x="1.5" y="4.5" width="13" height="7" fill="${PAPER}" ${o()}/>
    <path d="M5.3 4.5 v7 M8 4.5 v7 M10.7 4.5 v7" stroke="${STEEL_D}" stroke-width=".8"/>
    <rect x="4" y="4.5" width="2" height="4" fill="${INK}"/><rect x="7" y="4.5" width="2" height="4" fill="${INK}"/><rect x="11" y="4.5" width="2" height="4" fill="${INK}"/>`,
  playlist: `<rect x="1.5" y="2.5" width="13" height="11" fill="#242a36" ${o()}/>
    <rect x="3" y="4" width="6" height="2" fill="${GRN}"/><rect x="3" y="7" width="9" height="2" fill="${YEL}"/><rect x="5" y="10" width="6" height="2" fill="${PINK}"/>`,
  mixer: `<rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="${STEEL_D}" ${o()}/>
    <path d="M4.5 4 v8 M8 4 v8 M11.5 4 v8" stroke="${INK}" stroke-width="1"/>
    <rect x="3" y="9" width="3" height="2" fill="${PAPER}" ${o()}/><rect x="6.5" y="5.5" width="3" height="2" fill="${PAPER}" ${o()}/><rect x="10" y="7.5" width="3" height="2" fill="${PAPER}" ${o()}/>`,
  wrench: `<path d="M10.5 2.5 a3.4 3.4 0 1 0 2.6 5.6 l-2-2 1.4-1.4 2 2 a3.4 3.4 0 0 0-4-4.2 Z" fill="${STEEL}" ${o('stroke-linejoin="round"')}/>
    <path d="M8.4 7.6 L3.2 12.8 l1.4 1.4 5.2-5.2 Z" fill="${STEEL_D}" ${o('stroke-linejoin="round"')}/>`,
  folder: `<path d="M1.5 4 h5 l1.4 1.6 h6.6 v7.9 h-13 Z" fill="${YEL}" ${o('stroke-linejoin="round"')}/>
    <path d="M1.5 6.8 h13" stroke="${YEL_D}" stroke-width="1"/>`,
  disk: `<circle cx="8" cy="8" r="6.2" fill="${STEEL}" ${o()}/>
    <path d="M8 1.8 a6.2 6.2 0 0 1 5.4 3.1 l-3.6 2 a2.2 2.2 0 0 0-1.8-1 Z" fill="${CYAN}" opacity=".85"/>
    <circle cx="8" cy="8" r="1.7" fill="${PAPER}" ${o()}/>`,
  trash: `<path d="M4 5 h8 l-.8 8.5 h-6.4 Z" fill="${STEEL}" ${o('stroke-linejoin="round"')}/>
    <rect x="3" y="3" width="10" height="2" rx=".6" fill="${STEEL_D}" ${o()}/>
    <path d="M6.6 7 v4.5 M9.4 7 v4.5" stroke="${STEEL_D}" stroke-width="1"/>`,
  moon: `<path d="M10.4 1.9 a6.4 6.4 0 1 0 3.4 10.9 A5.2 5.2 0 0 1 10.4 1.9 Z" fill="${PINK}" ${o('stroke-linejoin="round"')}/>
    <path d="M12.6 3.2 l.6 1.5 1.5.6 -1.5.6 -.6 1.5 -.6-1.5 -1.5-.6 1.5-.6 Z" fill="${CYAN}" stroke="${INK}" stroke-width=".7" stroke-linejoin="round"/>`,
  screen: `<rect x="1.5" y="2.5" width="13" height="9" rx="1" fill="${STEEL}" ${o()}/>
    <rect x="3" y="4" width="10" height="6" fill="${BLUE}"/>
    <path d="M6 11.5 h4 l.8 2 h-5.6 Z" fill="${STEEL_D}" ${o('stroke-linejoin="round"')}/>`,

  /* ---- fichiers ---- */
  floppy: `<rect x="1.8" y="1.8" width="12.4" height="12.4" rx=".8" fill="${BLUE}" ${o()}/>
    <rect x="4.5" y="2.4" width="7" height="4.4" fill="${PAPER}" ${o('stroke-width=".8"')}/>
    <rect x="8.6" y="3" width="1.8" height="3.2" fill="${STEEL_D}"/>
    <rect x="3.6" y="8.6" width="8.8" height="5.6" fill="${PAPER}" ${o('stroke-width=".8"')}/>
    <path d="M5 10.2 h6 M5 11.8 h6" stroke="${STEEL_D}" stroke-width=".8"/>`,
  doc: `<path d="M3.5 1.8 h6 l3 3 v9.4 h-9 Z" fill="${PAPER}" ${o('stroke-linejoin="round"')}/>
    <path d="M9.5 1.8 v3 h3" fill="none" ${o()}/>
    <path d="M5.4 7.5 h5 M5.4 9.5 h5 M5.4 11.5 h3" stroke="${STEEL_D}" stroke-width="1"/>`,
  down: `<path d="M8 2 v7 M4.8 6.2 L8 9.6 11.2 6.2" fill="none" stroke="${GRN}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M3 11.5 h10" stroke="${GRN}" stroke-width="2" stroke-linecap="round"/>`,
  up: `<path d="M8 10.5 v-7 M4.8 6.6 L8 3.2 11.2 6.6" fill="none" stroke="${BLUE_L}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M3 13 h10" stroke="${BLUE_L}" stroke-width="2" stroke-linecap="round"/>`,
  newdoc: `<path d="M3.5 1.8 h6 l3 3 v9.4 h-9 Z" fill="${PAPER}" ${o('stroke-linejoin="round"')}/>
    <path d="M9.5 1.8 v3 h3" fill="none" ${o()}/>
    <path d="M8 7 v5 M5.5 9.5 h5" stroke="${GRN}" stroke-width="1.8" stroke-linecap="round"/>`,

  /* ---- actions ---- */
  dice: `<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2" fill="${PAPER}" ${o()}/>
    <circle cx="5.4" cy="5.4" r="1.25" fill="${INK}"/><circle cx="10.6" cy="5.4" r="1.25" fill="${INK}"/>
    <circle cx="8" cy="8" r="1.25" fill="${RED}"/>
    <circle cx="5.4" cy="10.6" r="1.25" fill="${INK}"/><circle cx="10.6" cy="10.6" r="1.25" fill="${INK}"/>`,
  broom: `<path d="M9.5 1.6 L11.8 3.9 6.6 9.1 4.3 6.8 Z" fill="${STEEL_D}" ${o('stroke-linejoin="round"')}/>
    <path d="M5.6 8.1 L2.2 13.8 7.9 10.4 Z" fill="${YEL}" ${o('stroke-linejoin="round"')}/>`,
  wand: `<path d="M2.4 13.6 L10.2 5.8 11.8 7.4 4 15.2 Z" fill="${BLUE}" ${o('stroke-linejoin="round"')}/>
    <path d="M12.2 1.2 l.9 2.1 2.1.9 -2.1.9 -.9 2.1 -.9-2.1 -2.1-.9 2.1-.9 Z" fill="${YEL}" ${o('stroke-linejoin="round"')}/>`,
  scissors: `<circle cx="4" cy="12" r="2.2" fill="none" ${o('stroke-width="1.4"')}/><circle cx="10.4" cy="12" r="2.2" fill="none" ${o('stroke-width="1.4"')}/>
    <path d="M12.6 2.2 L5.2 10.6 M3 2.2 L10.2 10.4" stroke="${STEEL_D}" stroke-width="1.6" stroke-linecap="round"/>`,
  wave: `<path d="M1.5 8 h1.4 v-3 h1.4 v6 h1.4 v-8 h1.4 v10 h1.4 v-7 h1.4 v4 h1.4 v-2 h1.4" fill="none" stroke="${CYAN}" stroke-width="1.3" stroke-linejoin="round"/>`,
  mic: `<rect x="6" y="1.8" width="4" height="7.4" rx="2" fill="${RED}" ${o()}/>
    <path d="M4 8 a4 4 0 0 0 8 0" fill="none" ${o('stroke-width="1.3"')}/>
    <path d="M8 12 v2.2 M5.6 14.2 h4.8" ${o('stroke-width="1.3" stroke-linecap="round"')}/>`,
  note: `<path d="M6 12 V3.4 l6-1.4 v8.6" fill="none" ${o('stroke-width="1.3"')}/>
    <ellipse cx="4.4" cy="12" rx="2.4" ry="1.9" fill="${PINK}" ${o()}/>
    <ellipse cx="10.4" cy="10.6" rx="2.4" ry="1.9" fill="${PINK}" ${o()}/>`,
  speaker: `<path d="M2 6 h2.6 L8 3 v10 L4.6 10 H2 Z" fill="${STEEL}" ${o('stroke-linejoin="round"')}/>
    <path d="M10 5.6 a3.4 3.4 0 0 1 0 4.8 M12.2 3.6 a6.4 6.4 0 0 1 0 8.8" fill="none" stroke="${CYAN}" stroke-width="1.3" stroke-linecap="round"/>`,
  keyboard: `<rect x="1" y="4" width="14" height="8" rx="1" fill="${STEEL}" ${o()}/>
    <path d="M3 6 h1.6 M5.8 6 h1.6 M8.6 6 h1.6 M11.4 6 h1.6 M3 8.2 h1.6 M5.8 8.2 h1.6 M8.6 8.2 h1.6 M11.4 8.2 h1.6 M5 10.4 h6" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/>`,
  help: `<circle cx="8" cy="8" r="6.2" fill="${BLUE}" ${o()}/>
    <path d="M6.2 6.2 a1.9 1.9 0 1 1 2.4 2.2 v1" fill="none" stroke="${PAPER}" stroke-width="1.5" stroke-linecap="round"/>
    <circle cx="8" cy="11.4" r=".95" fill="${PAPER}"/>`,
  power: `<path d="M8 2.4 v5.4" stroke="${GRN}" stroke-width="2" stroke-linecap="round"/>
    <path d="M4.6 4.6 a4.8 4.8 0 1 0 6.8 0" fill="none" stroke="${GRN}" stroke-width="2" stroke-linecap="round"/>`,
  star: `<path d="M8 1.6 l1.7 4.2 4.5.3 -3.5 2.9 1.1 4.4 -3.8-2.4 -3.8 2.4 1.1-4.4 -3.5-2.9 4.5-.3 Z" fill="${YEL}" ${o('stroke-linejoin="round"')}/>`,
  gear: `<circle cx="8" cy="8" r="3.2" fill="${STEEL}" ${o()}/>
    <path d="M8 1.4 v2.2 M8 12.4 v2.2 M1.4 8 h2.2 M12.4 8 h2.2 M3.3 3.3 l1.6 1.6 M11.1 11.1 l1.6 1.6 M12.7 3.3 l-1.6 1.6 M4.9 11.1 l-1.6 1.6" stroke="${STEEL_D}" stroke-width="2" stroke-linecap="round"/>
    <circle cx="8" cy="8" r="1.3" fill="${INK}"/>`,
  clock: `<circle cx="8" cy="8" r="6.2" fill="${PAPER}" ${o()}/>
    <path d="M8 4.4 v3.8 l2.6 1.6" fill="none" ${o('stroke-width="1.3" stroke-linecap="round"')}/>`,
  net: `<circle cx="8" cy="8" r="6.2" fill="${BLUE}" ${o()}/>
    <path d="M1.8 8 h12.4 M8 1.8 a9 9 0 0 1 0 12.4 M8 1.8 a9 9 0 0 0 0 12.4" fill="none" stroke="${BLUE_L}" stroke-width="1"/>`,
  sun: `<circle cx="8" cy="8" r="3.4" fill="${YEL}" ${o()}/>
    <path d="M8 1 v2 M8 13 v2 M1 8 h2 M13 8 h2 M3.2 3.2 l1.4 1.4 M11.4 11.4 l1.4 1.4 M12.8 3.2 l-1.4 1.4 M4.6 11.4 l-1.4 1.4" stroke="${YEL_D}" stroke-width="1.6" stroke-linecap="round"/>`,
  plus: `<path d="M8 3 v10 M3 8 h10" stroke="${GRN}" stroke-width="2.4" stroke-linecap="round"/>`,
  minus: `<path d="M3 8 h10" stroke="${RED}" stroke-width="2.4" stroke-linecap="round"/>`,
  close: `<path d="M4 4 l8 8 M12 4 l-8 8" stroke="${RED}" stroke-width="2.2" stroke-linecap="round"/>`,
  arrowUp: `<path d="M8 3.5 L13 11 H3 Z" fill="${STEEL}" ${o('stroke-linejoin="round"')}/>`,
  arrowDown: `<path d="M8 12.5 L3 5 h10 Z" fill="${STEEL}" ${o('stroke-linejoin="round"')}/>`,
  plug: `<path d="M6 1.8 v3.4 M10 1.8 v3.4" stroke="${STEEL_D}" stroke-width="1.6" stroke-linecap="round"/>
    <rect x="3.8" y="5.2" width="8.4" height="4.4" rx="1" fill="${YEL}" ${o()}/>
    <path d="M8 9.6 v4.6" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`,
  sleep: `<path d="M2.5 3.5 h5 l-5 5 h5" fill="none" stroke="${BLUE_L}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M9 8 h4.5 l-4.5 4.5 h4.5" fill="none" stroke="${BLUE}" stroke-width="1.6" stroke-linejoin="round"/>`,
}

export type IconName = keyof typeof SHAPES | string

export function iconHTML(name: IconName, size = 16): string {
  const s = SHAPES[name]
  if (!s) return ''
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" aria-hidden="true">${s}</svg>`
}

/** Icone prete a inserer dans le DOM. */
export function icon(name: IconName, size = 16): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = 'icw'
  span.style.width = `${size}px`
  span.style.height = `${size}px`
  span.innerHTML = iconHTML(name, size)
  return span
}

export const hasIcon = (n: string) => n in SHAPES

/* ============================================================
   VITEAU — la mascotte
   Descendant spirituel du trombone : une tete de CD sous un casque.
   Dessine, pas emprunte a une police d'emoji.
   ============================================================ */

export type VtMood = 'normal' | 'cool' | 'wow' | 'wink' | 'flat' | 'sleep'

const FACES: Record<VtMood, string> = {
  normal: `<circle cx="20" cy="21" r="1.7" fill="${INK}"/><circle cx="28" cy="21" r="1.7" fill="${INK}"/>
    <path d="M20.5 26 q3.5 3 7 0" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`,
  cool: `<path d="M15.5 20 h17 v1.4 h-17 Z" fill="${INK}"/>
    <path d="M16.5 20.6 h6 v3.6 a3 3 0 0 1-6 0 Z M25.5 20.6 h6 v3.6 a3 3 0 0 1-6 0 Z" fill="${INK}"/>
    <path d="M20.5 27 q4 2.4 7.5-.6" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`,
  wow: `<circle cx="20" cy="20.6" r="2.4" fill="none" stroke="${INK}" stroke-width="1.5"/>
    <circle cx="28" cy="20.6" r="2.4" fill="none" stroke="${INK}" stroke-width="1.5"/>
    <ellipse cx="24" cy="27.4" rx="2.6" ry="3.1" fill="${INK}"/>`,
  wink: `<circle cx="20" cy="21" r="1.7" fill="${INK}"/>
    <path d="M26 21 h4" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/>
    <path d="M19.5 25.4 q4.5 4.4 9 0" fill="none" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/>`,
  flat: `<path d="M18 21 h4 M26 21 h4" stroke="${INK}" stroke-width="1.7" stroke-linecap="round"/>
    <path d="M20.5 27 h7" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>`,
  sleep: `<path d="M17.6 21 q2.4 2.4 4.8 0 M25.6 21 q2.4 2.4 4.8 0" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M21.5 27 q2.5-2 5 0" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M33 15 h4 l-4 4 h4" fill="none" stroke="${BLUE_L}" stroke-width="1.4" stroke-linejoin="round"/>`,
}

export function viteauSVG(mood: VtMood = 'normal', size = 54): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <ellipse cx="24" cy="45" rx="11" ry="2.4" fill="rgba(0,0,0,.28)"/>
    <path d="M13 44 v-6 a11 11 0 0 1 22 0 v6 Z" fill="${BLUE}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M17 44 v-5 M31 44 v-5" stroke="#1c4e9a" stroke-width="1.2"/>
    <path d="M11 34 l-4 6" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
    <path d="M37 34 l4 6" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
    <path d="M11 34 l-4 6" stroke="${BLUE}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M37 34 l4 6" stroke="${BLUE}" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="24" cy="23" r="12.5" fill="${STEEL}" stroke="${INK}" stroke-width="1.6"/>
    <path d="M24 10.5 a12.5 12.5 0 0 1 10.9 6.4 l-6.6 3.7 a5 5 0 0 0-4.3-2.6 Z" fill="${CYAN}" opacity=".55"/>
    <path d="M24 35.5 a12.5 12.5 0 0 1-10.9-6.4 l6.6-3.7 a5 5 0 0 0 4.3 2.6 Z" fill="${PINK}" opacity=".4"/>
    ${FACES[mood]}
    <path d="M9.5 24 a14.5 14.5 0 0 1 29 0" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
    <rect x="5.6" y="21.5" width="6" height="9" rx="2.4" fill="${PINK}" stroke="${INK}" stroke-width="1.4"/>
    <rect x="36.4" y="21.5" width="6" height="9" rx="2.4" fill="${PINK}" stroke="${INK}" stroke-width="1.4"/>
  </svg>`
}

/* ============================================================
   LE LOGO
   Chrome a ligne d'horizon, cerne noir, ombre portee et un disque
   qui tourne : la grammaire des logos de 2001, construite en SVG
   plutot qu'empilee en ombres de texte.
   ============================================================ */

export function logoSVG(): string {
  const face = `'Trebuchet MS', 'DejaVu Sans', Verdana, Impact, sans-serif`
  // textLength fige la largeur des mots : la police de repli varie d'une
  // machine a l'autre, le logo, lui, ne doit pas bouger.
  const word = (x: number, y: number, size: number, len: number, txt: string, fill: string, stroke: string) => `
    <text x="${x}" y="${y}" font-size="${size}" textLength="${len}" lengthAdjust="spacingAndGlyphs"
          fill="#000" opacity=".42" transform="translate(2,2.5)">${txt}</text>
    <text x="${x}" y="${y}" font-size="${size}" textLength="${len}" lengthAdjust="spacingAndGlyphs"
          fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round">${txt}</text>`

  return `<svg class="logo-svg" width="192" height="48" viewBox="0 0 192 48" fill="none" aria-label="DJ ViDAW">
  <defs>
    <linearGradient id="lg-chrome" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"    stop-color="#ffffff"/>
      <stop offset=".26"  stop-color="#d3e3f7"/>
      <stop offset=".47"  stop-color="#7995ba"/>
      <stop offset=".505" stop-color="#1d3350"/>
      <stop offset=".545" stop-color="#c2d9f0"/>
      <stop offset=".78"  stop-color="#ffffff"/>
      <stop offset="1"    stop-color="#8aa9cd"/>
    </linearGradient>
    <linearGradient id="lg-pink" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"   stop-color="#ffd7ef"/>
      <stop offset=".42" stop-color="#ff5cb0"/>
      <stop offset=".52" stop-color="#c9147a"/>
      <stop offset="1"   stop-color="#ff8fd0"/>
    </linearGradient>
    <radialGradient id="lg-disc" cx=".36" cy=".3" r=".85">
      <stop offset="0"   stop-color="#f6f8fb"/>
      <stop offset=".45" stop-color="#aeb6c4"/>
      <stop offset="1"   stop-color="#5e6675"/>
    </radialGradient>
  </defs>

  <g class="logo-disc">
    <circle cx="20" cy="24" r="16" fill="url(#lg-disc)" stroke="#0d1220" stroke-width="1.6"/>
    <path d="M20 8 a16 16 0 0 1 13.9 8.1 l-9.4 5.3 a5.4 5.4 0 0 0-4.5-2.6 Z" fill="#5fe6ff" opacity=".7"/>
    <path d="M20 40 a16 16 0 0 1-13.9-8.1 l9.4-5.3 a5.4 5.4 0 0 0 4.5 2.6 Z" fill="#ff5cb0" opacity=".55"/>
    <circle cx="20" cy="24" r="11.5" fill="none" stroke="rgba(0,0,0,.22)" stroke-width=".8"/>
    <circle cx="20" cy="24" r="8" fill="none" stroke="rgba(0,0,0,.22)" stroke-width=".8"/>
    <circle cx="20" cy="24" r="4.2" fill="#e9edf3" stroke="#0d1220" stroke-width="1.4"/>
    <circle cx="20" cy="24" r="1.4" fill="#0d1220"/>
  </g>

  <g font-family="${face}" font-weight="900" paint-order="stroke fill">
    <g transform="rotate(-5 56 24)">${word(42, 31, 27, 30, 'DJ', 'url(#lg-pink)', '#12070d')}</g>
    ${word(76, 32, 30, 98, 'ViDAW', 'url(#lg-chrome)', '#0a1424')}
  </g>

  <text x="77" y="43" font-family="${face}" font-size="6" font-weight="700"
        textLength="96" lengthAdjust="spacing" fill="#93abca">STATION AUDIONUMERIQUE</text>

  <path class="logo-spark" d="M180 8 l1.5 4.6 4.6 1.5 -4.6 1.5 -1.5 4.6 -1.5-4.6 -4.6-1.5 4.6-1.5 Z"
        fill="#fff8c9" stroke="#c9a227" stroke-width=".7" stroke-linejoin="round"/>
</svg>`
}
