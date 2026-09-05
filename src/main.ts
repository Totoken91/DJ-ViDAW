/* ============================================================
   DJ ViDAW v1.0
   par DJ Viteau — un DAW complet dans un onglet, habille en 2001.
   ============================================================ */

import './styles/xp.css'
import './styles/daw.css'
import './styles/goofy.css'

import { h } from './ui/dom'
import { Win } from './ui/win'
import { Rack } from './ui/rack'
import { PianoRoll } from './ui/pianoroll'
import { Playlist } from './ui/playlist'
import { Mixer } from './ui/mixer'
import { ChannelEditor } from './ui/channel'
import { Browser } from './ui/browser'
import { Transport } from './ui/transport'
import { Viteau } from './ui/viteau'
import { boot, dialog, toast, Taskbar, Saver, desktopIcon, type MenuEntry } from './ui/shell'
import type { Ctx } from './ui/ctx'

import { Engine } from './audio/engine'
import { Samples } from './audio/samples'
import { renderProject, bufferToWav, encodeWav, downloadBlob } from './audio/render'
import { demoProject, type Project, clamp } from './core/state'

/* ------------------------------------------------------------------ */
/* Etat global                                                         */
/* ------------------------------------------------------------------ */

const SAVE_KEY = 'vidaw.project.v1'

let project: Project = demoProject()
const samples = new Samples()
const engine = new Engine(project, samples)

const app = document.getElementById('app')!
const desktop = h('div', { id: 'desktop' })
const viteau = new Viteau()
const saver = new Saver()

let rack: Rack, roll: PianoRoll, playlist: Playlist, mixer: Mixer, chEditor: ChannelEditor, browser: Browser, transport: Transport
const wins = new Map<string, Win>()
let dirty = false

const ctx: Ctx = {
  get project() { return project },
  set project(p: Project) { project = p },
  engine, samples,
  selected: project.channels[0]?.id ?? '',
  refresh(what = 'all') {
    if (what === 'all' || what === 'rack') rack?.render()
    if (what === 'all' || what === 'roll') roll?.draw()
    if (what === 'all' || what === 'playlist') playlist?.draw()
    if (what === 'all' || what === 'mixer') mixer?.render()
    if (what === 'all' || what === 'browser') browser?.render()
    if (what === 'all') { chEditor?.render(); transport?.refreshPatterns(); transport?.paint() }
  },
  sync() { engine.project = project; engine.sync() },
  selectChannel(id) {
    ctx.selected = id
    rack?.setSelected()
    chEditor?.show(id)
    roll?.setChannel(id)
    const w = wins.get('roll')
    if (w?.open) w.setTitle(`Piano roll — ${ctx.channel(id)?.name ?? ''}`)
  },
  channel(id) { return project.channels.find((c) => c.id === id) },
  openWindow(id) { wins.get(id)?.restore() },
  toast,
  say: (m) => viteau.say(m),
  dialog,
  markDirty() { dirty = true },
}

/* ------------------------------------------------------------------ */
/* Sauvegarde / chargement                                             */
/* ------------------------------------------------------------------ */

function saveLocal() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(project))
    dirty = false
    toast('Projet enregistre dans le navigateur.')
  } catch { toast('Echec de la sauvegarde (stockage plein ?)') }
}

function loadLocal() {
  const raw = localStorage.getItem(SAVE_KEY)
  if (!raw) { toast('Aucun projet enregistre.'); return }
  try {
    const p = JSON.parse(raw) as Project
    if (!p.channels?.length) throw new Error('vide')
    adoptProject(p)
    toast(`Projet "${p.name}" recharge.`)
  } catch { toast('Fichier de sauvegarde illisible.') }
}

function adoptProject(p: Project) {
  engine.stop()
  project = p
  ctx.project = p
  engine.project = p
  ctx.selected = p.channels[0]?.id ?? ''
  // le graphe doit etre reconstruit : on repart d'un contexte propre
  if (engine.graph) { engine.graph.dispose() }
  engine.graph = null
  engine.ctx?.close().catch(() => { /* deja ferme */ })
  engine.ctx = null
  ctx.refresh('all')
  ctx.selectChannel(ctx.selected)
  dirty = false
}

/** Fichier .vidaw : le projet + tous les samples embarques en WAV base64. */
async function exportProjectFile() {
  const payload = {
    format: 'dj-vidaw/1',
    project,
    samples: samples.list().map((s) => ({
      id: s.id, name: s.name,
      wav: blobToB64Sync(bufferToWav(s.buffer)),
    })),
  }
  // l'encodage base64 est asynchrone : on resout d'abord
  const resolved = { ...payload, samples: await Promise.all(payload.samples.map(async (s) => ({ ...s, wav: await s.wav }))) }
  const blob = new Blob([JSON.stringify(resolved)], { type: 'application/json' })
  downloadBlob(blob, `${slug(project.name)}.vidaw`)
  toast('Projet exporte (samples inclus).')
  dirty = false
}

function blobToB64Sync(b: Blob): Promise<string> {
  return new Promise((res) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1] ?? '')
    r.readAsDataURL(b)
  })
}

async function importProjectFile(file: File) {
  try {
    const data = JSON.parse(await file.text())
    if (data.format !== 'dj-vidaw/1') throw new Error('format')
    const actx = await engine.init()
    const idMap = new Map<string, string>()
    for (const s of data.samples ?? []) {
      const bin = Uint8Array.from(atob(s.wav), (ch) => ch.charCodeAt(0))
      const buf = await actx.decodeAudioData(bin.buffer)
      idMap.set(s.id, samples.add(s.name, buf).id)
    }
    const p = data.project as Project
    for (const ch of p.channels) {
      if (ch.sampler?.sampleId) ch.sampler.sampleId = idMap.get(ch.sampler.sampleId) ?? null
    }
    adoptProject(p)
    toast(`"${p.name}" charge avec ${data.samples?.length ?? 0} sample(s).`)
  } catch {
    dialog({ title: 'Erreur de lecture', icon: '❌', body: 'Ce fichier ne ressemble pas a un projet DJ ViDAW.' })
  }
}

const slug = (s: string) => s.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'projet'

/* ------------------------------------------------------------------ */
/* Export audio                                                        */
/* ------------------------------------------------------------------ */

function exportDialog() {
  const modeSel = h('select', { class: 'sel' },
    h('option', { value: 'song' }, 'La chanson entiere (playlist)'),
    h('option', { value: 'pattern' }, 'Le motif courant seulement'),
  )
  const repeats = h('input', { class: 'txt', type: 'number', value: '4', min: '1', max: '64', style: { width: '60px' } })
  const tail = h('input', { class: 'txt', type: 'number', value: '2', min: '0', max: '10', step: '0.5', style: { width: '60px' } })
  const bar = h('i')
  const prog = h('div', { class: 'prog', style: { display: 'none', marginTop: '10px' } }, bar)
  const status = h('div', { style: { marginTop: '6px', fontSize: '10px', color: '#333' } })

  const body = h('div', {},
    h('div', { style: { marginBottom: '8px' } }, 'Qu\'est-ce qu\'on grave sur le CD-R ?'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 10px', alignItems: 'center' } },
      h('span', {}, 'Contenu'), modeSel,
      h('span', {}, 'Repetitions du motif'), repeats,
      h('span', {}, 'Queue (secondes)'), tail,
    ),
    prog, status,
  )

  dialog({
    title: 'Exporter en WAV', icon: '💾', body,
    buttons: [
      {
        label: 'Graver !', primary: true, onClick: () => { /* remplace ci-dessous */ },
      },
      { label: 'Annuler' },
    ],
  })

  // On remplace le bouton pour garder la boite ouverte pendant le rendu
  const dlgBtns = document.querySelectorAll<HTMLElement>('#modal-layer .xp-btn')
  const goBtn = dlgBtns[0]
  if (!goBtn) return
  const fresh = goBtn.cloneNode(true) as HTMLElement
  goBtn.replaceWith(fresh)
  fresh.addEventListener('click', async () => {
    fresh.setAttribute('disabled', 'true')
    fresh.textContent = 'Gravure...'
    prog.style.display = ''
    status.textContent = 'Rendu hors-ligne en cours...'
    try {
      const buf = await renderProject(project, samples, {
        mode: modeSel.value as 'song' | 'pattern',
        tail: clamp(Number(tail.value) || 2, 0, 10),
        repeats: clamp(Number(repeats.value) || 4, 1, 64),
        onProgress: (p) => { bar.style.width = `${Math.round(p * 100)}%` },
      })
      downloadBlob(bufferToWav(buf), `${slug(project.name)}_${project.bpm}bpm.wav`)
      status.textContent = `Termine — ${buf.duration.toFixed(1)}s`
      viteau.say('Exporte ! Envoie-le a un label. Ou pas.')
      setTimeout(() => document.getElementById('modal-layer')?.classList.remove('on'), 900)
    } catch (e) {
      status.textContent = `Echec du rendu : ${String(e)}`
      fresh.removeAttribute('disabled')
      fresh.textContent = 'Reessayer'
    }
  })
}

/* Enregistrement en direct de la sortie master */
function toggleLiveRec() {
  if (engine.recording) {
    const r = engine.stopRec()
    if (r) {
      downloadBlob(encodeWav([r.l, r.r], r.rate), `${slug(project.name)}_live.wav`)
      toast('Enregistrement live sauvegarde.')
    } else toast('Rien n\'a ete capture.')
    document.querySelectorAll('.btn.rec').forEach((b) => b.classList.remove('on'))
  } else {
    void engine.init().then(() => {
      if (engine.startRec()) {
        toast('Enregistrement de la sortie... refais REC pour arreter.')
        document.querySelectorAll('.btn.rec').forEach((b) => b.classList.add('on'))
        if (!engine.playing) void engine.play()
      }
    })
  }
}

/* ------------------------------------------------------------------ */
/* Construction de l'interface                                         */
/* ------------------------------------------------------------------ */

function buildUI() {
  rack = new Rack(ctx, (id) => { ctx.selectChannel(id); wins.get('roll')?.restore() })
  roll = new PianoRoll(ctx, ctx.selected)
  playlist = new Playlist(ctx)
  mixer = new Mixer(ctx)
  chEditor = new ChannelEditor(ctx)
  browser = new Browser(ctx)
  transport = new Transport(ctx, exportDialog, toggleLiveRec)

  const W = window.innerWidth, H = window.innerHeight - 100
  const mk = (id: string, title: string, icon: string, content: HTMLElement,
              x: number, y: number, w: number, hh: number, onResize?: () => void) => {
    const win = new Win({
      id, title, icon,
      x: Math.min(x, Math.max(10, W - w - 10)), y: Math.min(y, Math.max(10, H - 80)),
      w: Math.min(w, W - 20), h: Math.min(hh, H - 10),
      onResize,
    }, desktop)
    win.body.appendChild(content)
    wins.set(id, win)
    return win
  }

  mk('rack', 'Channel Rack', '🥁', rack.el, 12, 10, 660, 320)
  mk('roll', 'Piano roll', '🎹', roll.el, 300, 200, 720, 400, () => roll.resize())
  mk('playlist', 'Playlist', '📊', playlist.el, 60, 350, 780, 300, () => playlist.resize())
  mk('mixer', 'Mixeur', '🎚', mixer.el, 690, 10, 620, 560)
  mk('channel', 'Reglages du channel', '🔧', chEditor.el, 120, 90, 620, 470)
  mk('browser', 'Navigateur de samples', '📁', browser.el, 30, 60, 380, 420)

  wins.get('roll')!.close()
  wins.get('mixer')!.close()
  wins.get('browser')!.close()
  wins.get('channel')!.close()

  /* --- menu Demarrer --- */
  const fileInput = h('input', { type: 'file', accept: '.vidaw,application/json', style: { display: 'none' } })
  fileInput.addEventListener('change', () => {
    const f = (fileInput as HTMLInputElement).files?.[0]
    if (f) void importProjectFile(f)
    ;(fileInput as HTMLInputElement).value = ''
  })
  document.body.appendChild(fileInput)

  const entries: MenuEntry[] = [
    { icon: '🥁', label: 'Channel Rack', sub: 'le sequenceur', onClick: () => wins.get('rack')!.restore() },
    { icon: '🎹', label: 'Piano roll', sub: 'les notes', onClick: () => wins.get('roll')!.restore() },
    { icon: '📊', label: 'Playlist', sub: 'arranger le morceau', onClick: () => wins.get('playlist')!.restore() },
    { icon: '🎚', label: 'Mixeur & effets', onClick: () => wins.get('mixer')!.restore() },
    { icon: '🔧', label: 'Reglages du channel', onClick: () => wins.get('channel')!.restore() },
    { icon: '📁', label: 'Navigateur de samples', onClick: () => wins.get('browser')!.restore() },
    { sep: true, icon: '', label: '' },
    { icon: '💾', label: 'Enregistrer', sub: 'dans le navigateur', onClick: saveLocal },
    { icon: '📂', label: 'Recharger', sub: 'la derniere sauvegarde', onClick: loadLocal },
    { icon: '⬇️', label: 'Exporter le projet', sub: 'fichier .vidaw', onClick: () => void exportProjectFile() },
    { icon: '⬆️', label: 'Ouvrir un projet', sub: 'fichier .vidaw', onClick: () => fileInput.click() },
    { icon: '🎵', label: 'Exporter en WAV', onClick: exportDialog },

    { icon: '🆕', label: 'Nouveau projet', right: true, onClick: () => {
      dialog({
        title: 'Nouveau projet', icon: '🆕',
        body: 'On efface tout et on recommence ? Le projet actuel sera perdu s\'il n\'est pas enregistre.',
        buttons: [
          { label: 'Oui, tout casser', primary: true, onClick: () => { adoptProject(demoProject()); toast('Nouveau projet.') } },
          { label: 'Non' },
        ],
      })
    } },
    { icon: '🎲', label: 'Beat aleatoire', right: true, onClick: () => {
      rack.randomize()
    } },
    { icon: '🕺', label: 'Viteau', sub: 'l\'assistant', right: true, onClick: () => {
      const on = viteau.toggle()
      toast(on ? 'Viteau active.' : 'Viteau baillonne.')
    } },
    { icon: '💤', label: 'Economiseur d\'ecran', right: true, onClick: () => saver.start() },
    { icon: '⌨️', label: 'Raccourcis clavier', right: true, onClick: showHelp },
    { icon: '❓', label: 'A propos', right: true, onClick: showAbout },
  ]

  const taskbar = new Taskbar(entries, 'DJ Viteau')
  for (const [id, win] of wins) {
    win.taskBtn = taskbar.addButton(`${win.opts.icon} ${win.opts.title}`, () => win.toggle())
    win.opts.onClose = () => { /* le bouton reste, il rouvre la fenetre */ }
    void id
  }

  /* --- icones du bureau --- */
  const icons: [string, string, string][] = [
    ['💿', 'Poste de travail', 'rack'],
    ['🎹', 'Piano roll', 'roll'],
    ['📁', 'Mes Samples', 'browser'],
    ['🎚', 'Mixeur', 'mixer'],
  ]
  icons.forEach(([ic, lb, target], i) => {
    desktop.appendChild(desktopIcon(ic, lb, 14, 12 + i * 84, () => wins.get(target)!.restore()))
  })
  desktop.appendChild(desktopIcon('🗑️', 'Corbeille', 14, 12 + icons.length * 84, () => {
    dialog({ title: 'Corbeille', icon: '🗑️', body: 'La corbeille contient 0 element. Et 3 maquettes de 2003.' })
  }))

  /* --- stickers --- */
  const stickers: [string, number, number, string, string][] = [
    ['★ NOUVEAU ! ★\n100% SANS PLUGIN', 78, 16, '#ff2e88', '-8deg'],
    ['⚡ TESTÉ SUR\nPENTIUM III ⚡', 76, 62, '#0d8fd0', '5deg'],
    ['♪ BEST VIEWED IN\n1024 x 768 ♪', 6, 88, '#7a2ecc', '2deg'],
  ]
  for (const [txt, x, y, col, rot] of stickers) {
    const el = h('div', {
      class: 'sticker',
      style: { left: `${x}%`, top: `${y}%`, background: col, '--rot': rot },
    })
    el.innerText = txt
    desktop.appendChild(el)
  }

  app.append(transport.el, desktop, taskbar.el, taskbar.menu, viteau.el, saver.el)

  ctx.selectChannel(ctx.selected)
  transport.scope.analyser = engine.graph?.analyser ?? null
  requestAnimationFrame(() => { transport.scope.resize(); roll.resize(); playlist.resize() })
}

/* ------------------------------------------------------------------ */
/* Boites d'aide                                                       */
/* ------------------------------------------------------------------ */

function showHelp() {
  const rows: [string, string][] = [
    ['Espace / F5', 'Jouer ou arreter le motif'],
    ['F6', 'Jouer ou arreter la chanson (playlist)'],
    ['Echap', 'Tout arreter'],
    ['Ctrl + S', 'Enregistrer dans le navigateur'],
    ['Ctrl + R', 'Beat aleatoire'],
    ['1 … 9', 'Selectionner le channel'],
    ['Clic sur un pas', 'Poser / retirer une note'],
    ['Clic droit sur un pas', 'Changer la velocite'],
    ['Molette sur un potard', 'Reglage · maj = fin'],
    ['Double-clic potard', 'Valeur par defaut'],
    ['Ctrl + molette', 'Zoom (piano roll, playlist)'],
    ['Alt + clic (forme d\'onde)', 'Poser une tranche'],
  ]
  dialog({
    title: 'Raccourcis clavier', icon: '⌨️',
    body: h('table', { style: { borderCollapse: 'collapse', width: '100%' } },
      ...rows.map(([k, v]) => h('tr', {},
        h('td', { style: { padding: '3px 10px 3px 0', fontWeight: '700', whiteSpace: 'nowrap' } }, k),
        h('td', { style: { padding: '3px 0' } }, v)))),
  })
}

function showAbout() {
  dialog({
    title: 'A propos de DJ ViDAW', icon: '💿',
    body: h('div', {},
      h('div', { class: 'wordart', style: { fontSize: '26px', marginBottom: '8px' } }, 'DJ ViDAW 1.0'),
      h('p', { style: { margin: '0 0 8px' } }, 'Station de travail audionumerique concue par ', h('b', {}, 'DJ Viteau'), '.'),
      h('p', { style: { margin: '0 0 8px' } },
        'Tout le son est fabrique en direct par le navigateur : percussions synthetisees, ',
        'synthetiseur soustractif, sampler avec decoupe, neuf effets et un export WAV rendu hors-ligne.'),
      h('p', { style: { margin: '0 0 8px', fontSize: '10px', color: '#555' } },
        'Aucune donnee ne quitte ta machine. Aucun fichier audio n\'est embarque : ',
        'tout est genere par des oscillateurs, comme en 2001.'),
      h('p', { style: { margin: '0', fontStyle: 'italic' } }, '« Si ca clippe, c\'est que c\'est bien. » — DJ Viteau'),
    ),
  })
}

/* ------------------------------------------------------------------ */
/* Raccourcis clavier                                                  */
/* ------------------------------------------------------------------ */

function bindKeys() {
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement
    if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return
    const k = e.key

    if (k === ' ' || k === 'F5') {
      e.preventDefault()
      if (engine.playing && engine.mode === 'pattern') engine.stop()
      else { engine.stop(); void engine.play('pattern'); viteau.playQuip() }
      transport.paint()
    } else if (k === 'F6') {
      e.preventDefault()
      if (engine.playing && engine.mode === 'song') engine.stop()
      else { engine.stop(); void engine.play('song') }
      transport.paint()
    } else if (k === 'Escape') {
      engine.stop(); transport.paint()
    } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 's') {
      e.preventDefault(); saveLocal()
    } else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'r') {
      e.preventDefault(); rack.randomize()
    } else if (/^[1-9]$/.test(k)) {
      const ch = project.channels[Number(k) - 1]
      if (ch) ctx.selectChannel(ch.id)
    }
  })

  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return
    e.preventDefault()
    e.returnValue = ''
  })

  // Glisser-deposer d'un fichier n'importe ou sur le bureau
  const stop = (e: Event) => { e.preventDefault(); e.stopPropagation() }
  for (const t of ['dragenter', 'dragover', 'drop']) document.addEventListener(t, stop)
  document.addEventListener('drop', (e) => {
    const files = [...((e as DragEvent).dataTransfer?.files ?? [])]
    if (!files.length) return
    const proj = files.find((f) => /\.vidaw$/i.test(f.name))
    if (proj) { void importProjectFile(proj); return }
    wins.get('browser')!.restore()
    void browser.importFiles(files)
  })

  window.addEventListener('resize', () => {
    transport.scope.resize()
    roll.resize()
    playlist.resize()
  })
}

/* ------------------------------------------------------------------ */
/* Boucle d'animation                                                  */
/* ------------------------------------------------------------------ */

function loop() {
  transport.scope.draw()
  if (wins.get('mixer')?.open) mixer.tick()
  requestAnimationFrame(loop)
}

/* ------------------------------------------------------------------ */
/* Demarrage                                                           */
/* ------------------------------------------------------------------ */

const bootEl = boot(async () => {
  bootEl.classList.add('gone')
  setTimeout(() => bootEl.remove(), 600)
  try {
    await engine.init()
    transport.scope.analyser = engine.graph?.analyser ?? null
    ctx.refresh('mixer')          // les vu-metres ont besoin des analyseurs
    startupChime()
  } catch {
    toast('Le moteur audio a refuse de demarrer. Reclique quelque part.')
  }
  setTimeout(() => viteau.say('Bienvenue dans DJ ViDAW ! Appuie sur ESPACE, ca fait du bruit. 🔊'), 900)
})

/** Le petit jingle de demarrage, synthetise evidemment. */
function startupChime() {
  const a = engine.ctx
  if (!a) return
  const t0 = a.currentTime + 0.05
  const notes = [[0, 587.33], [0.14, 880], [0.28, 1174.66], [0.42, 1567.98]]
  const bus = a.createGain()
  bus.gain.value = 0.16
  const rev = a.createConvolver()
  const ir = a.createBuffer(2, a.sampleRate * 1.6, a.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3)
  }
  rev.buffer = ir
  bus.connect(rev).connect(a.destination)
  bus.connect(a.destination)
  for (const [dt, f] of notes) {
    for (const mul of [1, 2.01]) {
      const o = a.createOscillator(), g = a.createGain()
      o.type = 'sine'
      o.frequency.value = f * mul
      g.gain.setValueAtTime(0, t0 + dt)
      g.gain.linearRampToValueAtTime(mul === 1 ? 0.5 : 0.18, t0 + dt + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + dt + 1.5)
      o.connect(g).connect(bus)
      o.start(t0 + dt); o.stop(t0 + dt + 1.6)
    }
  }
}

app.appendChild(bootEl)
buildUI()
bindKeys()
loop()

engine.onStep = (s) => {
  rack.setPlayhead(engine.mode === 'pattern' ? s : -1)
  roll.setPlayhead(engine.mode === 'pattern' ? s : -1)
  playlist.setPlayhead(engine.mode === 'song' ? s : -1)
  transport.setPosition(Math.max(0, s))
}
engine.onError = (m) => toast(m)

// Rechargement automatique de la derniere session, si elle existe
if (localStorage.getItem(SAVE_KEY)) {
  setTimeout(() => {
    dialog({
      title: 'Session precedente', icon: '📂',
      body: 'Un projet enregistre a ete retrouve dans ce navigateur. On le recharge ?',
      buttons: [
        { label: 'Recharger', primary: true, onClick: loadLocal },
        { label: 'Non merci' },
      ],
    })
  }, 1400)
}

// eslint-disable-next-line no-console
console.log('%c DJ ViDAW ', 'background:#ff4fd8;color:#fff;font:bold 16px sans-serif;padding:4px',
  'v1.0 — par DJ Viteau')
