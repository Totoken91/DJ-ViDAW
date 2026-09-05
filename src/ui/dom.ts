/* Micro-helpers DOM : moins verbeux que document.createElement partout. */

type Attrs = Record<string, unknown>
type Child = Node | string | number | null | undefined | false

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Attrs = {}, ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'class') el.className = String(v)
    else if (k === 'style' && typeof v === 'object') applyStyle(el, v as Record<string, string>)
    else if (k === 'dataset') Object.assign(el.dataset, v as object)
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener)
    else if (k === 'html') el.innerHTML = String(v)
    else el.setAttribute(k, String(v))
  }
  add(el, children)
  return el
}

/** Object.assign ne sait pas ecrire les variables CSS : il faut setProperty. */
function applyStyle(el: HTMLElement, style: Record<string, string>) {
  for (const [k, v] of Object.entries(style)) {
    if (k.startsWith('--')) el.style.setProperty(k, String(v))
    else (el.style as unknown as Record<string, string>)[k] = String(v)
  }
}

function add(el: HTMLElement, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector<T>(sel)
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  [...root.querySelectorAll<T>(sel)]

export function clear(el: HTMLElement) { while (el.firstChild) el.removeChild(el.firstChild) }

/* Glisser-deposer generique : renvoie dx/dy depuis l'origine du geste. */
export function drag(
  el: HTMLElement,
  onMove: (dx: number, dy: number, e: PointerEvent) => void,
  onStart?: (e: PointerEvent) => boolean | void,
  onEnd?: (e: PointerEvent) => void,
) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    if (onStart?.(e) === false) return
    const x0 = e.clientX, y0 = e.clientY
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => onMove(ev.clientX - x0, ev.clientY - y0, ev)
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      try { el.releasePointerCapture(e.pointerId) } catch { /* deja relache */ }
      onEnd?.(ev)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    e.preventDefault()
  })
}

export const fmt = (n: number, d = 2) => n.toFixed(d).replace(/\.?0+$/, '') || '0'
