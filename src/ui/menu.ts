/* ============================================================
   DJ ViDAW — MENUS CONTEXTUELS
   Dans FL Studio, le clic droit n'est pas un accessoire : c'est la
   moitie de l'interface. Chaque objet (channel, pas, potard, note)
   repond au clic droit par ses propres actions. Ce module fournit le
   menu partage par tous : navigation clavier, sous-menus, raccourcis
   affiches, et retournement automatique pres des bords.
   ============================================================ */

import { h } from './dom'
import { icon } from './icons'

export interface MenuEntry {
  label: string
  /** Nom d'icone (voir ui/icons). */
  ico?: string
  /** Pastille de couleur dans la gouttiere, a la place de l'icone. */
  swatch?: string
  /** Raccourci affiche a droite. Purement indicatif. */
  accel?: string
  /** Coche a gauche pour les bascules. */
  checked?: boolean
  disabled?: boolean
  /** Rouge : action destructrice. */
  danger?: boolean
  onClick?: () => void
  sub?: MenuItem[]
}
export type MenuItem = MenuEntry | '-' | { title: string }

function isEntry(i: MenuItem): i is MenuEntry {
  return typeof i === 'object' && 'label' in i
}

let open: { el: HTMLElement; close: () => void } | null = null

/** Ferme le menu ouvert, s'il y en a un. */
export function closeMenu() { open?.close() }

export interface MenuOpts {
  /** Titre en tete de menu : rappelle sur quoi on a clique. */
  title?: string
  /** Largeur minimale, en px. */
  width?: number
}

/**
 * Ouvre un menu contextuel a la position de l'evenement.
 * Un seul menu vit a la fois — ouvrir en ferme un autre.
 */
export function contextMenu(
  ev: MouseEvent | PointerEvent | { clientX: number; clientY: number },
  items: MenuItem[],
  opts: MenuOpts = {},
): void {
  closeMenu()
  if ('preventDefault' in ev && typeof ev.preventDefault === 'function') ev.preventDefault()

  const root = buildLevel(items, opts, 0)
  document.body.appendChild(root.el)
  place(root.el, ev.clientX, ev.clientY, null)

  const onDown = (e: Event) => {
    const t = e.target as Node
    if (root.contains(t)) return
    closeMenu()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu() }
  }
  const onScroll = () => closeMenu()

  // capture : on veut fermer avant que le clic n'atteigne l'appli dessous
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('contextmenu', onDown, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('blur', onScroll)
  window.addEventListener('resize', onScroll)
  document.addEventListener('scroll', onScroll, true)

  const close = () => {
    if (open?.el !== root.el) return
    open = null
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('contextmenu', onDown, true)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('blur', onScroll)
    window.removeEventListener('resize', onScroll)
    document.removeEventListener('scroll', onScroll, true)
    root.destroy()
  }
  root.setClose(close)
  open = { el: root.el, close }
  root.el.focus()
}

/* ------------------------------------------------------------------ */

interface Level {
  el: HTMLElement
  contains(n: Node): boolean
  destroy(): void
  setClose(fn: () => void): void
}

function buildLevel(items: MenuItem[], opts: MenuOpts, depth: number): Level {
  const el = h('div', { class: 'ctxmenu', tabindex: '-1' })
  if (opts.width) el.style.minWidth = `${opts.width}px`
  if (opts.title) el.appendChild(h('div', { class: 'ctx-head' }, opts.title))

  let close: () => void = () => {}
  let child: { level: Level; from: HTMLElement } | null = null
  let subTimer = 0

  const closeSub = () => {
    window.clearTimeout(subTimer)
    if (!child) return
    child.from.classList.remove('open')
    child.level.destroy()
    child = null
  }

  const rows: HTMLElement[] = []

  for (const it of items) {
    if (it === '-') { el.appendChild(h('div', { class: 'ctx-sep' })); continue }
    if (!isEntry(it)) { el.appendChild(h('div', { class: 'ctx-title' }, it.title)); continue }

    const row = h('div', {
      class: `ctx-row${it.disabled ? ' off' : ''}${it.danger ? ' danger' : ''}${it.checked && !it.swatch ? ' checked' : ''}`,
    },
      h('span', { class: 'ctx-ico' },
        it.swatch ? h('span', { class: `ctx-swatch${it.checked ? ' on' : ''}`, style: { background: it.swatch } })
          : it.checked ? '✔' : it.ico ? icon(it.ico, 12) : ''),
      h('span', { class: 'ctx-label' }, it.label),
      it.sub ? h('span', { class: 'ctx-arrow' }, '▸')
        : it.accel ? h('span', { class: 'ctx-accel' }, it.accel) : null,
    )

    if (!it.disabled) {
      const openSub = () => {
        if (child?.from === row) return
        closeSub()
        const lv = buildLevel(it.sub!, {}, depth + 1)
        lv.setClose(() => close())
        document.body.appendChild(lv.el)
        const r = row.getBoundingClientRect()
        place(lv.el, r.right - 3, r.top - 4, r)
        row.classList.add('open')
        child = { level: lv, from: row }
      }

      row.addEventListener('pointerenter', () => {
        for (const r of rows) r.classList.remove('hot')
        row.classList.add('hot')
        window.clearTimeout(subTimer)
        if (it.sub) subTimer = window.setTimeout(openSub, 90)
        else closeSub()
      })
      // Le clic ferme d'abord : une action qui ouvre une boite de dialogue
      // ne doit pas la voir disparaitre avec le menu.
      row.addEventListener('click', () => {
        if (it.sub) { openSub(); return }
        close()
        it.onClick?.()
      })
      rows.push(row)
    }
    el.appendChild(row)
  }

  /* --- navigation clavier --- */
  el.addEventListener('keydown', (e) => {
    // Tant que le menu est ouvert, il mange les touches : sinon la lettre
    // qu'on tape pour atteindre une entree jouerait aussi une note.
    e.stopPropagation()
    const i = rows.findIndex((r) => r.classList.contains('hot'))
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!rows.length) return
      const d = e.key === 'ArrowDown' ? 1 : -1
      const n = (i < 0 ? (d > 0 ? 0 : rows.length - 1) : (i + d + rows.length) % rows.length)
      rows.forEach((r) => r.classList.remove('hot'))
      rows[n].classList.add('hot')
      rows[n].scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (i >= 0) rows[i].click()
    } else if (e.key.length === 1) {
      const c = e.key.toLowerCase()
      const start = i + 1
      for (let k = 0; k < rows.length; k++) {
        const r = rows[(start + k) % rows.length]
        if ((r.textContent || '').trim().toLowerCase().startsWith(c)) {
          rows.forEach((x) => x.classList.remove('hot'))
          r.classList.add('hot')
          r.scrollIntoView({ block: 'nearest' })
          break
        }
      }
    }
  })

  return {
    el,
    contains: (n: Node) => el.contains(n) || !!child?.level.contains(n),
    destroy() { closeSub(); el.remove() },
    setClose(fn) { close = fn },
  }
}

/** Place le menu en le rabattant si l'ecran manque de place. */
function place(el: HTMLElement, x: number, y: number, parentRow: DOMRect | null) {
  el.style.left = '0px'; el.style.top = '0px'
  const w = el.offsetWidth, hh = el.offsetHeight
  const vw = window.innerWidth, vh = window.innerHeight
  let nx = x, ny = y
  if (nx + w > vw - 4) nx = parentRow ? Math.max(4, parentRow.left - w + 3) : Math.max(4, vw - w - 4)
  if (ny + hh > vh - 4) ny = Math.max(4, vh - hh - 4)
  el.style.left = `${Math.round(nx)}px`
  el.style.top = `${Math.round(ny)}px`
}

/* ------------------------------------------------------------------ */

/** Menu minimal : une liste de libelles, un index en retour. */
export function pickMenu(
  ev: { clientX: number; clientY: number },
  labels: string[], current: number, onPick: (i: number) => void, title?: string,
) {
  contextMenu(ev, labels.map((l, i) => ({
    label: l, checked: i === current, onClick: () => onPick(i),
  })), { title })
}
