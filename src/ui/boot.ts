/* ============================================================
   DJ ViDAW — SEQUENCE DE DEMARRAGE
   Deux ecrans, tels qu'ils existaient vraiment :
   1. le POST du BIOS, en mode texte VGA, aligne a gauche ;
   2. le splash du logiciel, une fenetre sans bordure avec un
      bandeau d'etat et une barre segmentee.
   Le clic final n'est pas une decoration : les navigateurs
   refusent de demarrer l'audio sans geste de l'utilisateur.
   ============================================================ */

import { h, clear } from './dom'
import { logoSVG } from './icons'

interface PostLine { label: string; value: string; delay: number }

const POST: PostLine[] = [
  { label: 'Main Processor', value: 'Pentium III 733 MHz', delay: 130 },
  { label: 'Memory Testing', value: '', delay: 40 },
  { label: 'Primary Master', value: 'VIDAW-HDD 40.0GB', delay: 150 },
  { label: 'Primary Slave', value: 'None', delay: 90 },
  { label: 'Secondary Master', value: 'CD-RW 8x4x32', delay: 140 },
  { label: 'Audio Device', value: 'ViDAW SoundBlast 128', delay: 170 },
  { label: 'Pointing Device', value: 'PS/2 Mouse', delay: 110 },
]

const LOADING = [
  'Initialisation du moteur audio',
  'Chargement des tables d\'ondes',
  'Construction du rack de percussions',
  'Enregistrement des 36 presets',
  'Verification de la licence',
  'Preparation du bureau',
]

const pad = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n)

export function boot(onStart: () => void): HTMLElement {
  const screen = h('div', { class: 'boot-screen' })
  const el = h('div', { id: 'boot', role: 'status', 'aria-live': 'polite' }, screen)

  let stage: 'post' | 'splash' | 'ready' = 'post'
  let skip = false
  const timers: number[] = []
  const at = (ms: number, fn: () => void) => { timers.push(window.setTimeout(fn, ms)) }
  const cancel = () => { timers.forEach(clearTimeout); timers.length = 0 }

  /* ---------------- 1. POST ---------------- */

  const postLog = h('pre', { class: 'post-log' })
  const memLine = h('span', {}, '')

  function runPost() {
    clear(screen)
    screen.className = 'boot-screen post'
    screen.append(
      h('div', { class: 'post-head' },
        h('pre', {}, 'ViDAW BIOS v1.02\nCopyright (C) 2001, Viteau Systems Inc.'),
        h('div', { class: 'post-star', title: 'Energy Star' },
          h('div', { class: 'star-arc' }), h('span', {}, 'ENERGY'), h('b', {}, 'STAR')),
      ),
      postLog,
      h('pre', { class: 'post-foot' },
        'Press ', h('b', {}, 'DEL'), ' to enter SETUP, ', h('b', {}, 'ESC'), ' to skip memory test\n',
        '06/09/01-VIDAW-686-2A6LGV1BC-00', h('span', { class: 'caret' }, '_')),
    )
    clear(postLog)

    let t = 240
    at(t, () => postLog.append(h('div', {}, `${pad('Main Processor', 22)}: Pentium III 733 MHz`)))
    t += 200
    // le test memoire compte, comme il le faisait vraiment
    at(t, () => postLog.append(h('div', {}, pad('Memory Testing', 22) + ': ', memLine)))
    for (let i = 1; i <= 16; i++) {
      at(t + i * 34, () => { memLine.textContent = `${(i * 16384).toLocaleString('en-US').replace(/,/g, '')}K` })
    }
    at(t + 16 * 34 + 60, () => { memLine.textContent = '262144K OK' })
    t += 16 * 34 + 120

    for (const line of POST) {
      if (line.label === 'Memory Testing' || line.label === 'Main Processor') continue
      t += line.delay
      at(t, () => postLog.append(h('div', {}, `${pad(line.label, 22)}: ${line.value}`)))
    }
    t += 220
    at(t, () => postLog.append(h('div', { class: 'ok' }, `${pad('Boot Sequence', 22)}: HDD-0`)))
    at(t + 340, () => runSplash())
  }

  /* ---------------- 2. splash du logiciel ---------------- */

  const status = h('div', { class: 'sp-status' }, 'Demarrage...')
  const bar = h('div', { class: 'sp-bar' })
  const action = h('div', { class: 'sp-action' })

  function runSplash() {
    stage = 'splash'
    clear(screen)
    screen.className = 'boot-screen splash'
    clear(bar); clear(action)
    for (let i = 0; i < 28; i++) bar.appendChild(h('i'))

    screen.appendChild(
      h('div', { class: 'sp-win' },
        h('div', { class: 'sp-art' },
          h('div', { class: 'sp-logo', html: logoSVG() }),
          h('div', { class: 'sp-ver' }, 'Version 1.0 — build 2001.09.06'),
        ),
        h('div', { class: 'sp-panel' },
          h('div', { class: 'sp-lic' },
            h('span', {}, 'Ce produit est concede sous licence a :'),
            h('b', {}, 'DJ VITEAU'),
            h('span', {}, 'Station audionumerique — 7 channels, 9 inserts')),
          bar, status, action,
          h('div', { class: 'sp-copy' }, 'Copyright (C) 2001 Viteau Systems. Tous droits reserves. Ne pas ecouter au-dessus de 11 sur 10.'),
        ),
      ),
    )

    const blocks = [...bar.children] as HTMLElement[]
    const per = skip ? 6 : 46
    blocks.forEach((b, i) => at(i * per + 40, () => b.classList.add('on')))
    LOADING.forEach((txt, i) => {
      at(Math.floor((i / LOADING.length) * blocks.length) * per + 60,
        () => { status.textContent = `${txt}...` })
    })
    at(blocks.length * per + 220, ready)
  }

  /* ---------------- 3. le geste qui autorise le son ---------------- */

  function ready() {
    stage = 'ready'
    status.innerHTML = ''
    status.append(
      h('b', {}, 'Pret.'),
      document.createTextNode(' Le navigateur exige un clic avant d\'autoriser le son.'),
    )
    const go = h('button', { class: 'xp-btn primary boot-go', type: 'button' }, 'Demarrer DJ ViDAW')
    go.addEventListener('click', onStart)
    action.appendChild(go)
    action.appendChild(h('span', { class: 'sp-kbd' }, 'ou appuie sur Entree'))
    setTimeout(() => go.focus(), 30)
  }

  /* ---------------- passer l'ecran ---------------- */

  const hurry = (e: Event) => {
    if (stage === 'ready') {
      if (e instanceof KeyboardEvent && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        el.querySelector<HTMLElement>('.boot-go')?.click()
      }
      return
    }
    if (e instanceof KeyboardEvent && !['Escape', 'Enter', ' '].includes(e.key)) return
    skip = true
    cancel()
    if (stage === 'post') runSplash()
  }
  el.addEventListener('pointerdown', hurry)
  window.addEventListener('keydown', hurry)

  runPost()
  return el
}
