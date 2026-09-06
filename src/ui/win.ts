/* ============================================================
   DJ ViDAW — GESTIONNAIRE DE FENETRES
   Fenetres Windows XP : deplacables, redimensionnables, avec
   accrochage aux bords, animations d'ouverture et memorisation
   de la disposition.
   ============================================================ */

import { h, drag } from './dom'
import { icon } from './icons'

export interface WinOpts {
  id: string
  title: string
  icon: string
  x: number; y: number
  w: number; h: number
  minW?: number; minH?: number
  resizable?: boolean
  onClose?: () => void
  onResize?: () => void
  onGeometry?: () => void
}

export interface Geometry { x: number; y: number; w: number; h: number; open: boolean; min: boolean; max: boolean }

let zTop = 100
let snapGhost: HTMLElement | null = null

type Zone = 'none' | 'max' | 'left' | 'right' | 'tl' | 'tr' | 'bl' | 'br'

/** Zone d'accrochage sous le pointeur, selon sa proximite des bords. */
function zoneAt(x: number, y: number, host: DOMRect): Zone {
  const m = 26
  const nearL = x - host.left < m, nearR = host.right - x < m
  const nearT = y - host.top < m, nearB = host.bottom - y < m
  if (nearT && nearL) return 'tl'
  if (nearT && nearR) return 'tr'
  if (nearB && nearL) return 'bl'
  if (nearB && nearR) return 'br'
  if (nearT) return 'max'
  if (nearL) return 'left'
  if (nearR) return 'right'
  return 'none'
}

function zoneRect(z: Zone, host: DOMRect) {
  const W = host.width, H = host.height
  switch (z) {
    case 'max': return { x: 0, y: 0, w: W, h: H }
    case 'left': return { x: 0, y: 0, w: W / 2, h: H }
    case 'right': return { x: W / 2, y: 0, w: W / 2, h: H }
    case 'tl': return { x: 0, y: 0, w: W / 2, h: H / 2 }
    case 'tr': return { x: W / 2, y: 0, w: W / 2, h: H / 2 }
    case 'bl': return { x: 0, y: H / 2, w: W / 2, h: H / 2 }
    case 'br': return { x: W / 2, y: H / 2, w: W / 2, h: H / 2 }
    default: return null
  }
}

export class Win {
  el: HTMLElement
  body: HTMLElement
  titleEl: HTMLElement
  taskBtn: HTMLElement | null = null
  opts: WinOpts
  private maxed = false
  private prev = { x: 0, y: 0, w: 0, h: 0 }
  open = true

  constructor(opts: WinOpts, private desktop: HTMLElement) {
    this.opts = opts
    this.body = h('div', { class: 'win-body' })
    this.titleEl = h('span', { class: 'win-title-text' }, opts.title)

    const btn = (cls: string, label: string, fn: () => void) =>
      h('button', {
        class: `win-btn ${cls}`, type: 'button', title: label, 'aria-label': label,
        onclick: (e: Event) => { e.stopPropagation(); fn() },
      })

    const bar = h('div', { class: 'win-title' },
      icon(opts.icon, 16),
      this.titleEl,
      h('div', { class: 'win-btns' },
        btn('min', 'Reduire', () => this.minimize()),
        opts.resizable !== false ? btn('max', 'Agrandir', () => this.toggleMax()) : null,
        btn('close', 'Fermer', () => this.close()),
      ),
    )

    this.el = h('div', {
      class: 'win', role: 'dialog', 'aria-label': opts.title, dataset: { win: opts.id },
    }, bar, this.body, opts.resizable !== false ? h('div', { class: 'win-grip' }) : null)

    Object.assign(this.el.style, {
      left: `${opts.x}px`, top: `${opts.y}px`,
      width: `${opts.w}px`, height: `${opts.h}px`,
      zIndex: String(++zTop),
    })
    desktop.appendChild(this.el)

    /* ---------------- deplacement et accrochage ---------------- */
    let sx = 0, sy = 0, zone: Zone = 'none'
    drag(bar, (dx, dy, e) => {
      if (this.maxed) {
        // sortir d'une fenetre agrandie en la tirant : elle reprend sa taille
        this.toggleMax()
        sx = e.clientX - this.el.offsetWidth / 2
        sy = 4
      }
      const host = this.desktop.getBoundingClientRect()
      this.el.style.left = `${Math.max(-this.el.offsetWidth + 90, sx + dx)}px`
      this.el.style.top = `${Math.max(0, Math.min(host.height - 34, sy + dy))}px`
      const z = zoneAt(e.clientX, e.clientY, host)
      if (z !== zone) { zone = z; this.showGhost(z, host) }
    }, (e) => {
      if ((e.target as HTMLElement).closest('.win-btn')) return false
      this.focus()
      sx = this.el.offsetLeft; sy = this.el.offsetTop
      zone = 'none'
      return true
    }, () => {
      const host = this.desktop.getBoundingClientRect()
      const r = zoneRect(zone, host)
      if (r) this.snapTo(r)
      zone = 'none'
      this.hideGhost()
      this.opts.onGeometry?.()
    })

    bar.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.win-btn')) return
      if (opts.resizable !== false) this.toggleMax()
    })

    /* ---------------- redimensionnement ---------------- */
    const grip = this.el.querySelector<HTMLElement>('.win-grip')
    if (grip) {
      let w0 = 0, h0 = 0
      drag(grip, (dx, dy) => {
        this.el.style.width = `${Math.max(opts.minW ?? 260, w0 + dx)}px`
        this.el.style.height = `${Math.max(opts.minH ?? 140, h0 + dy)}px`
        opts.onResize?.()
      }, () => { this.focus(); w0 = this.el.offsetWidth; h0 = this.el.offsetHeight },
         () => this.opts.onGeometry?.())
    }

    this.el.addEventListener('pointerdown', () => this.focus(), true)
  }

  /* ---------------- apercu d'accrochage ---------------- */
  private showGhost(z: Zone, host: DOMRect) {
    const r = zoneRect(z, host)
    if (!r) { this.hideGhost(); return }
    if (!snapGhost) {
      snapGhost = h('div', { class: 'snap-ghost' })
      this.desktop.appendChild(snapGhost)
    }
    Object.assign(snapGhost.style, {
      left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, opacity: '1',
    })
  }
  private hideGhost() { if (snapGhost) snapGhost.style.opacity = '0' }

  private snapTo(r: { x: number; y: number; w: number; h: number }) {
    this.prev = { x: this.el.offsetLeft, y: this.el.offsetTop, w: this.el.offsetWidth, h: this.el.offsetHeight }
    this.el.classList.add('snapping')
    Object.assign(this.el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` })
    setTimeout(() => { this.el.classList.remove('snapping'); this.opts.onResize?.() }, 150)
  }

  /* ---------------- etat ---------------- */

  focus() {
    this.el.style.zIndex = String(++zTop)
    document.querySelectorAll('.win.active').forEach((w) => w.classList.remove('active'))
    this.el.classList.add('active')
    this.taskBtn?.classList.add('down')
    document.querySelectorAll('.task-btn.down').forEach((b) => { if (b !== this.taskBtn) b.classList.remove('down') })
  }

  setTitle(t: string) {
    this.opts.title = t
    this.titleEl.textContent = t
    this.el.setAttribute('aria-label', t)
    const lbl = this.taskBtn?.querySelector('.tb-label')
    if (lbl) lbl.textContent = t
  }

  private animate(name: string) {
    this.el.style.animation = 'none'
    void this.el.offsetWidth      // force le redemarrage de l'animation
    this.el.style.animation = ''
    this.el.classList.remove('win-in', 'win-out')
    this.el.classList.add(name)
    const done = () => { this.el.classList.remove(name); this.el.removeEventListener('animationend', done) }
    this.el.addEventListener('animationend', done)
  }

  minimize() {
    this.el.classList.add('minimized')
    this.taskBtn?.classList.remove('down')
    this.opts.onGeometry?.()
  }

  restore() {
    const wasHidden = !this.open || this.el.classList.contains('minimized')
    this.el.classList.remove('minimized')
    this.open = true
    this.el.style.display = ''
    if (wasHidden) this.animate('win-in')
    this.focus()
    requestAnimationFrame(() => this.opts.onResize?.())
    this.opts.onGeometry?.()
  }

  toggle() {
    if (!this.open || this.el.classList.contains('minimized')) this.restore()
    else if (this.el.classList.contains('active')) this.minimize()
    else this.focus()
  }

  toggleMax() {
    if (this.maxed) {
      Object.assign(this.el.style, {
        left: `${this.prev.x}px`, top: `${this.prev.y}px`,
        width: `${this.prev.w}px`, height: `${this.prev.h}px`,
      })
      this.maxed = false
      this.el.classList.remove('maxed')
    } else {
      this.prev = { x: this.el.offsetLeft, y: this.el.offsetTop, w: this.el.offsetWidth, h: this.el.offsetHeight }
      this.el.classList.add('snapping')
      Object.assign(this.el.style, { left: '0px', top: '0px', width: '100%', height: '100%' })
      setTimeout(() => this.el.classList.remove('snapping'), 150)
      this.maxed = true
      this.el.classList.add('maxed')
    }
    setTimeout(() => this.opts.onResize?.(), 160)
    this.opts.onGeometry?.()
  }

  close() {
    if (!this.open) return
    this.open = false
    this.animate('win-out')
    const hide = () => { if (!this.open) this.el.style.display = 'none' }
    setTimeout(hide, 130)
    this.taskBtn?.classList.remove('down')
    this.opts.onClose?.()
    this.opts.onGeometry?.()
  }

  /* ---------------- disposition ---------------- */

  geometry(): Geometry {
    return {
      x: this.el.offsetLeft, y: this.el.offsetTop,
      w: this.el.offsetWidth, h: this.el.offsetHeight,
      open: this.open, min: this.el.classList.contains('minimized'), max: this.maxed,
    }
  }

  setGeometry(g: Partial<Geometry>) {
    const host = this.desktop.getBoundingClientRect()
    if (g.w) this.el.style.width = `${Math.min(g.w, host.width)}px`
    if (g.h) this.el.style.height = `${Math.min(g.h, host.height)}px`
    if (g.x !== undefined) this.el.style.left = `${Math.max(0, Math.min(g.x, host.width - 120))}px`
    if (g.y !== undefined) this.el.style.top = `${Math.max(0, Math.min(g.y, host.height - 40))}px`
    if (g.max) { this.maxed = false; this.toggleMax() }
    this.el.classList.toggle('minimized', !!g.min)
    if (g.open === false) { this.open = false; this.el.style.display = 'none' }
    else { this.open = true; this.el.style.display = '' }
    requestAnimationFrame(() => this.opts.onResize?.())
  }

  place(x: number, y: number, w: number, h: number) {
    this.maxed = false
    this.el.classList.remove('maxed', 'minimized')
    this.open = true
    this.el.style.display = ''
    this.el.classList.add('snapping')
    Object.assign(this.el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` })
    setTimeout(() => { this.el.classList.remove('snapping'); this.opts.onResize?.() }, 160)
  }
}
