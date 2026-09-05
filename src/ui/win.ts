/* ============================================================
   DJ ViDAW — GESTIONNAIRE DE FENETRES
   Fenetres Windows XP : deplacables, redimensionnables, minimisables,
   avec bouton dans la barre des taches.
   ============================================================ */

import { h, drag } from './dom'
import { icon } from './icons'

export interface WinOpts {
  id: string
  title: string
  icon: string          // nom dans le jeu d'icones
  x: number; y: number
  w: number; h: number
  minW?: number; minH?: number
  resizable?: boolean
  onClose?: () => void
  onResize?: () => void
}

let zTop = 100

export class Win {
  el: HTMLElement
  body: HTMLElement
  titleEl: HTMLElement
  taskBtn: HTMLElement | null = null
  opts: WinOpts
  private maxed = false
  private prev = { x: 0, y: 0, w: 0, h: 0 }
  open = true

  constructor(opts: WinOpts, desktop: HTMLElement) {
    this.opts = opts
    this.body = h('div', { class: 'win-body' })
    this.titleEl = h('span', { class: 'win-title-text' }, opts.title)

    const btn = (cls: string, label: string, fn: () => void) =>
      h('button', {
        class: `win-btn ${cls}`, type: 'button', title: label,
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

    this.el = h('div', { class: 'win', dataset: { win: opts.id } },
      bar,
      this.body,
      opts.resizable !== false ? h('div', { class: 'win-grip' }) : null,
    )
    Object.assign(this.el.style, {
      left: `${opts.x}px`, top: `${opts.y}px`,
      width: `${opts.w}px`, height: `${opts.h}px`,
      zIndex: String(++zTop),
    })

    desktop.appendChild(this.el)

    // Deplacement
    let sx = 0, sy = 0
    drag(bar, (dx, dy) => {
      if (this.maxed) return
      const nx = Math.max(-this.el.offsetWidth + 90, sx + dx)
      const ny = Math.max(0, Math.min(window.innerHeight - 40, sy + dy))
      this.el.style.left = `${nx}px`
      this.el.style.top = `${ny}px`
    }, (e) => {
      if ((e.target as HTMLElement).closest('.win-btn')) return false
      this.focus()
      sx = this.el.offsetLeft; sy = this.el.offsetTop
      return true
    })
    bar.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.win-btn')) return
      if (opts.resizable !== false) this.toggleMax()
    })

    // Redimensionnement
    const grip = this.el.querySelector<HTMLElement>('.win-grip')
    if (grip) {
      let w0 = 0, h0 = 0
      drag(grip, (dx, dy) => {
        this.el.style.width = `${Math.max(opts.minW ?? 260, w0 + dx)}px`
        this.el.style.height = `${Math.max(opts.minH ?? 140, h0 + dy)}px`
        opts.onResize?.()
      }, () => { this.focus(); w0 = this.el.offsetWidth; h0 = this.el.offsetHeight })
    }

    this.el.addEventListener('pointerdown', () => this.focus(), true)
  }

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
    const lbl = this.taskBtn?.querySelector('.tb-label')
    if (lbl) lbl.textContent = t
  }

  minimize() {
    this.el.classList.add('minimized')
    this.taskBtn?.classList.remove('down')
  }

  restore() {
    this.el.classList.remove('minimized')
    this.open = true
    this.el.style.display = ''
    this.focus()
    // un canvas dans une fenetre masquee mesure 0 : il faut le remesurer ici
    requestAnimationFrame(() => this.opts.onResize?.())
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
      Object.assign(this.el.style, { left: '0px', top: '0px', width: '100%', height: '100%' })
      this.maxed = true
      this.el.classList.add('maxed')
    }
    this.opts.onResize?.()
  }

  close() {
    this.open = false
    this.el.style.display = 'none'
    this.taskBtn?.classList.remove('down')
    this.opts.onClose?.()
  }
}
