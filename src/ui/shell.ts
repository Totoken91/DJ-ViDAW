/* ============================================================
   DJ ViDAW — LE SHELL "WINDOWS"
   Ecran de demarrage, barre des taches, menu Demarrer, boites de
   dialogue, bulles d'aide, economiseur d'ecran.
   ============================================================ */

import { h, clear } from './dom'

/* ---------------- Ecran de demarrage ---------------- */

export function boot(onStart: () => void): HTMLElement {
  const lines = [
    'DJ ViDAW BIOS v1.0 — (C) 2001 Viteau Systems',
    'Detection du materiel audio ................ OK',
    'Chargement des potards .................... OK',
    'Verification du niveau de goofy ........... 147%',
    'Anti-virus : aucun virus (ni antivirus) ... OK',
  ]
  const log = h('div', { class: 'boot-foot' })
  const el = h('div', { id: 'boot' },
    h('div', { class: 'boot-logo' }, 'DJ ViDAW'),
    h('div', { class: 'boot-sub' }, 'PAR DJ VITEAU'),
    h('div', { class: 'boot-bar' }, h('i')),
    h('button', { class: 'boot-go', style: { display: 'none' }, onclick: onStart }, '▶  DEMARRER LA MACHINE'),
    log,
  )
  let i = 0
  const tick = () => {
    if (i < lines.length) {
      log.appendChild(h('div', {}, lines[i++]))
      setTimeout(tick, 240 + Math.random() * 160)
    } else {
      const btn = el.querySelector<HTMLElement>('.boot-go')!
      btn.style.display = ''
      const bar = el.querySelector<HTMLElement>('.boot-bar')
      if (bar) bar.style.display = 'none'
      log.appendChild(h('div', { style: { marginTop: '8px', color: '#8fd0ff' } },
        'Le son ne peut demarrer qu\'apres un clic. Merci les navigateurs. 🙄'))
    }
  }
  setTimeout(tick, 300)
  return el
}

/* ---------------- Boites de dialogue ---------------- */

let modalLayer: HTMLElement | null = null

export function dialog(o: {
  title: string; icon?: string
  body: HTMLElement | string
  buttons?: { label: string; primary?: boolean; onClick?: () => void }[]
}) {
  if (!modalLayer) {
    modalLayer = h('div', { id: 'modal-layer' })
    document.body.appendChild(modalLayer)
    modalLayer.addEventListener('pointerdown', (e) => {
      if (e.target === modalLayer) closeDialog()
    })
  }
  clear(modalLayer)
  const btns = o.buttons ?? [{ label: 'OK', primary: true }]
  const dlg = h('div', { class: 'dialog' },
    h('div', { class: 'win-title' },
      h('span', { class: 'win-title-text' }, `${o.icon ?? '💬'}  ${o.title}`),
      h('div', { class: 'win-btns' },
        h('button', { class: 'win-btn close', onclick: () => closeDialog() })),
    ),
    h('div', { class: 'dlg-body' },
      h('div', { class: 'ic' }, o.icon ?? '💬'),
      h('div', { style: { flex: '1 1 auto' } }, typeof o.body === 'string' ? document.createTextNode(o.body) : o.body),
    ),
    h('div', { class: 'dlg-foot' }, ...btns.map((b) =>
      h('button', {
        class: `xp-btn${b.primary ? ' primary' : ''}`,
        onclick: () => { closeDialog(); b.onClick?.() },
      }, b.label))),
  )
  modalLayer.appendChild(dlg)
  modalLayer.classList.add('on')
}

export function closeDialog() { modalLayer?.classList.remove('on') }

/* ---------------- Bulles d'aide ---------------- */

let toastLayer: HTMLElement | null = null

export function toast(msg: string, ms = 3200) {
  if (!toastLayer) {
    toastLayer = h('div', { id: 'toast-layer' })
    document.body.appendChild(toastLayer)
  }
  const t = h('div', { class: 'toast' }, msg)
  toastLayer.appendChild(t)
  setTimeout(() => {
    t.style.transition = 'opacity .3s'
    t.style.opacity = '0'
    setTimeout(() => t.remove(), 320)
  }, ms)
}

/* ---------------- Economiseur d'ecran ---------------- */

export class Saver {
  el: HTMLElement
  private raf = 0
  private items: { el: HTMLElement; x: number; y: number; vx: number; vy: number }[] = []
  private idle = 0
  active = false
  enabled = true

  constructor() {
    this.el = h('div', { id: 'saver' }, h('div', { class: 'hint' }, 'bouge la souris pour revenir'))
    this.el.addEventListener('pointerdown', () => this.stop())
    const bump = () => { this.idle = 0; if (this.active) this.stop() }
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) {
      window.addEventListener(ev, bump, { passive: true })
    }
    setInterval(() => {
      if (!this.enabled || this.active) return
      this.idle++
      if (this.idle > 90) this.start()   // 90 s
    }, 1000)
  }

  start() {
    this.active = true
    this.el.classList.add('on')
    this.items.forEach((i) => i.el.remove())
    this.items = []
    const words = ['DJ ViDAW', '★ VITEAU ★', 'Y2K', '128 BPM', '♪ ♫ ♪']
    const cols = ['#00ff9c', '#ff4fd8', '#4fe9ff', '#ffd23d', '#ff6b3d']
    for (let i = 0; i < 4; i++) {
      const el = h('div', { class: 'dvd', style: { color: cols[i % cols.length] } }, words[i % words.length])
      this.el.appendChild(el)
      this.items.push({
        el, x: Math.random() * (window.innerWidth - 220), y: Math.random() * (window.innerHeight - 80),
        vx: (Math.random() > .5 ? 1 : -1) * (1 + Math.random() * 1.4),
        vy: (Math.random() > .5 ? 1 : -1) * (1 + Math.random() * 1.4),
      })
    }
    const loop = () => {
      if (!this.active) return
      for (const it of this.items) {
        const w = it.el.offsetWidth, hh = it.el.offsetHeight
        it.x += it.vx; it.y += it.vy
        if (it.x < 0 || it.x > window.innerWidth - w) { it.vx *= -1; this.recolor(it.el) }
        if (it.y < 0 || it.y > window.innerHeight - hh) { it.vy *= -1; this.recolor(it.el) }
        it.el.style.left = `${it.x}px`
        it.el.style.top = `${it.y}px`
      }
      this.raf = requestAnimationFrame(loop)
    }
    loop()
  }

  private recolor(el: HTMLElement) {
    const cols = ['#00ff9c', '#ff4fd8', '#4fe9ff', '#ffd23d', '#ff6b3d', '#a56bff']
    el.style.color = cols[Math.floor(Math.random() * cols.length)]
  }

  stop() {
    this.active = false
    this.idle = 0
    cancelAnimationFrame(this.raf)
    this.el.classList.remove('on')
  }
}

/* ---------------- Barre des taches ---------------- */

export interface MenuEntry {
  icon: string; label: string; sub?: string
  onClick?: () => void
  sep?: boolean
  right?: boolean
}

export class Taskbar {
  el: HTMLElement
  menu: HTMLElement
  btns: HTMLElement
  private startBtn: HTMLElement
  private clock: HTMLElement

  constructor(entries: MenuEntry[], user: string) {
    this.btns = h('div', { id: 'task-btns' })
    this.clock = h('div', { id: 'clock' }, '--:--')
    this.startBtn = h('button', { id: 'start-btn', onclick: () => this.toggleMenu() },
      h('span', { class: 'start-orb' }), 'demarrer')

    const left = h('div', { class: 'sm-left' })
    const right = h('div', { class: 'sm-right' })
    for (const e of entries) {
      const host = e.right ? right : left
      if (e.sep) { host.appendChild(h('div', { class: 'sm-sep' })); continue }
      host.appendChild(h('div', {
        class: 'sm-item',
        onclick: () => { this.closeMenu(); e.onClick?.() },
      },
        h('span', { class: 'ic' }, e.icon),
        h('span', {}, h('b', {}, e.label), e.sub ? h('div', { style: { fontSize: '10px', opacity: '.7' } }, e.sub) : null),
      ))
    }

    this.menu = h('div', { id: 'start-menu' },
      h('div', { class: 'sm-head' },
        h('div', { class: 'sm-avatar' }, '🕺'),
        h('span', {}, user)),
      h('div', { class: 'sm-cols' }, left, right),
      h('div', { class: 'sm-foot' },
        h('span', { onclick: () => { this.closeMenu(); location.reload() } }, '🔄 Redemarrer'),
        h('span', { onclick: () => { this.closeMenu(); window.close() } }, '⏻ Arreter'),
      ),
    )

    this.el = h('div', { id: 'taskbar' },
      this.startBtn, this.btns,
      h('div', { id: 'tray' },
        h('span', { class: 'tray-icon', title: 'Volume (decoratif)' }, '🔊'),
        h('span', { class: 'tray-icon', title: 'Reseau : 56k' }, '📡'),
        h('span', { class: 'tray-icon', title: 'Il fait beau' }, '☀️'),
        this.clock),
    )

    setInterval(() => {
      const d = new Date()
      this.clock.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }, 1000)
    const d = new Date()
    this.clock.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

    document.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement
      if (!t.closest('#start-menu') && !t.closest('#start-btn')) this.closeMenu()
    })
  }

  toggleMenu() {
    const on = this.menu.classList.toggle('on')
    this.startBtn.classList.toggle('on', on)
  }
  closeMenu() {
    this.menu.classList.remove('on')
    this.startBtn.classList.remove('on')
  }
  addButton(label: string, onClick: () => void): HTMLElement {
    const b = h('div', { class: 'task-btn', onclick: onClick }, label)
    this.btns.appendChild(b)
    return b
  }
}

/* ---------------- Icones du bureau ---------------- */

export function desktopIcon(icon: string, label: string, x: number, y: number, onOpen: () => void): HTMLElement {
  let last = 0
  const el = h('div', { class: 'dicon', style: { left: `${x}px`, top: `${y}px` } },
    h('div', { class: 'gl' }, icon),
    h('div', { class: 'lb' }, label))
  el.addEventListener('click', () => {
    const now = Date.now()
    if (now - last < 420) onOpen()
    last = now
  })
  el.addEventListener('dblclick', onOpen)
  return el
}
