/* ============================================================
   DJ ViDAW v1.0
   par DJ Viteau — un DAW complet dans un onglet, habille en 2001.
   ============================================================ */

import './styles/xp.css'
import './styles/daw.css'
import './styles/goofy.css'
import './styles/nightcore.css'

import { h, clear } from './ui/dom'
import { Win } from './ui/win'
import { Rack } from './ui/rack'
import { PianoRoll } from './ui/pianoroll'
import { Playlist } from './ui/playlist'
import { Mixer } from './ui/mixer'
import { ChannelEditor } from './ui/channel'
import { Browser } from './ui/browser'
import { Nightcore } from './ui/nightcore'
import { Transport } from './ui/transport'
import { Viteau } from './ui/viteau'
import { boot, dialog, toast, Taskbar, Saver, desktopIcon, type MenuEntry } from './ui/shell'
import { installWallpaper } from './ui/wallpaper'
import type { Ctx } from './ui/ctx'

import { Engine } from './audio/engine'
import { Samples } from './audio/samples'
import { renderProject, bufferToWav, bufferToWebm, canEncodeWebm } from './audio/render'
import { saveFile, isEmbedded, type SaveResult } from './core/save'
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

let rack: Rack, roll: PianoRoll, playlist: Playlist, mixer: Mixer, chEditor: ChannelEditor, browser: Browser, transport: Transport, nightcore: Nightcore
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
  offerRender: (buf, base, title) => audioResultDialog(buf, base, title),
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

/** Fichier de projet : le projet complet plus tous les samples embarques en
    WAV base64. L'extension .vidaw n'est pas reconnue par les hotes qui
    filtrent les telechargements ; le contenu etant du JSON, on le nomme
    .json chez eux. */
async function exportProjectFile() {
  const list = samples.list()
  const encoded = await Promise.all(list.map(async (s) => ({
    id: s.id, name: s.name, wav: await blobToB64(bufferToWav(s.buffer)),
  })))
  const blob = new Blob(
    [JSON.stringify({ format: 'dj-vidaw/1', project, samples: encoded })],
    { type: 'application/json' })
  const r = await saveFile(blob, `${slug(project.name)}.${isEmbedded() ? 'json' : 'vidaw'}`)
  if (r.ok) { toast(`Projet exporte (${list.length} sample${list.length > 1 ? 's' : ''} inclus).`); dirty = false }
  else reportSave(r)
}

function reportSave(r: SaveResult) {
  if (r.ok) return
  if (r.reason === 'declined') toast(r.message)
  else dialog({ title: 'Enregistrement impossible', icon: 'help', body: r.message })
}

function blobToB64(b: Blob): Promise<string> {
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
    dialog({ title: 'Erreur de lecture', icon: 'close', body: 'Ce fichier ne ressemble pas a un projet DJ ViDAW.' })
  }
}

const slug = (s: string) => s.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'projet'

/* ------------------------------------------------------------------ */
/* Export audio                                                        */
/* ------------------------------------------------------------------ */

/** Sort un rendu dans le format que l'hote accepte : WAV en page autonome,
    webm/Opus dans un viewer qui refuse le WAV. */
async function offerAudio(
  buf: AudioBuffer, base: string,
  onStatus: (s: string) => void, onProgress?: (p: number) => void,
) {
  if (!isEmbedded()) {
    const r = await saveFile(bufferToWav(buf), `${base}.wav`)
    onStatus(r.ok ? 'Fichier WAV enregistre.' : r.message)
    return
  }
  if (!canEncodeWebm()) {
    onStatus('Cet hote n\'accepte pas le WAV, et ce navigateur ne sait pas encoder en webm. Utilise le lecteur ci-dessus.')
    return
  }
  onStatus(`Encodage webm en temps reel — compte ${Math.ceil(buf.duration)} s.`)
  const actx = await engine.init()
  const blob = await bufferToWebm(actx, buf, onProgress)
  const r = await saveFile(blob, `${base}.webm`)
  onStatus(r.ok ? 'Fichier webm (Opus) enregistre.' : r.message)
}

/** Boite commune a l'export du projet et a la Nightcorification :
    on ecoute d'abord, on enregistre ensuite. */
function audioResultDialog(buf: AudioBuffer, base: string, title = 'Rendu termine') {
  const url = URL.createObjectURL(bufferToWav(buf))
  const player = h('audio', { controls: 'controls', style: { width: '100%', marginTop: '4px' } })
  player.src = url
  const bar = h('i')
  const prog = h('div', { class: 'prog', style: { display: 'none', marginTop: '8px' } }, bar)
  const status = h('div', { style: { marginTop: '6px', fontSize: '10px' } },
    `${buf.duration.toFixed(1)} s — ecoute, puis enregistre si ca te va.`)
  const saveBtn = h('button', { class: 'xp-btn primary save-audio' },
    isEmbedded() ? (canEncodeWebm() ? 'Enregistrer (.webm)' : 'Enregistrer') : 'Telecharger le WAV')
  saveBtn.addEventListener('click', async () => {
    saveBtn.setAttribute('disabled', 'true')
    prog.style.display = ''
    await offerAudio(buf, base, (m) => { status.textContent = m },
      (p) => { bar.style.width = `${Math.round(p * 100)}%` })
    saveBtn.removeAttribute('disabled')
  })
  dialog({
    title, icon: 'floppy',
    body: h('div', {}, player, prog, h('div', { style: { marginTop: '8px' } }, saveBtn), status),
    buttons: [{ label: 'Fermer', onClick: () => setTimeout(() => URL.revokeObjectURL(url), 2000) }],
  })
}

function exportDialog() {
  const embedded = isEmbedded()
  const modeSel = h('select', { class: 'sel' },
    h('option', { value: 'song' }, 'La chanson entiere (playlist)'),
    h('option', { value: 'pattern' }, 'Le motif courant seulement'),
  )
  const repeats = h('input', { class: 'txt', type: 'number', value: '4', min: '1', max: '64', style: { width: '60px' } })
  const tail = h('input', { class: 'txt', type: 'number', value: '2', min: '0', max: '10', step: '0.5', style: { width: '60px' } })
  const bar = h('i')
  const prog = h('div', { class: 'prog', style: { display: 'none', marginTop: '10px' } }, bar)
  const status = h('div', { style: { marginTop: '6px', fontSize: '10px', color: '#333' } })
  const player = h('audio', { controls: 'controls', style: { width: '100%', marginTop: '10px', display: 'none' } })
  const saveRow = h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } })
  let playerUrl = ''

  const body = h('div', {},
    h('div', { style: { marginBottom: '8px' } }, 'Qu\'est-ce qu\'on grave sur le CD-R ?'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 10px', alignItems: 'center' } },
      h('span', {}, 'Contenu'), modeSel,
      h('span', {}, 'Repetitions du motif'), repeats,
      h('span', {}, 'Queue (secondes)'), tail,
    ),
    prog, player, saveRow, status,
  )

  dialog({
    title: 'Exporter le morceau', icon: 'floppy', body,
    buttons: [{ label: 'Graver !', primary: true }, { label: 'Fermer' }],
  })

  // Le bouton est remplace pour garder la boite ouverte pendant le rendu.
  const goBtn = document.querySelector<HTMLElement>('#modal-layer .xp-btn.primary')
  if (!goBtn) return
  const fresh = goBtn.cloneNode(true) as HTMLElement
  goBtn.replaceWith(fresh)

  fresh.addEventListener('click', async () => {
    fresh.setAttribute('disabled', 'true')
    fresh.textContent = 'Gravure...'
    prog.style.display = ''
    bar.style.width = '0%'
    status.textContent = 'Rendu hors-ligne en cours...'
    clear(saveRow)
    try {
      const buf = await renderProject(project, samples, {
        mode: modeSel.value as 'song' | 'pattern',
        tail: clamp(Number(tail.value) || 2, 0, 10),
        repeats: clamp(Number(repeats.value) || 4, 1, 64),
        onProgress: (p) => { bar.style.width = `${Math.round(p * 100)}%` },
      })

      // Ecoute immediate : cela marche partout, y compris la ou l'hote
      // bloque les telechargements.
      if (playerUrl) URL.revokeObjectURL(playerUrl)
      playerUrl = URL.createObjectURL(bufferToWav(buf))
      player.src = playerUrl
      player.style.display = ''
      status.textContent = `Rendu termine — ${buf.duration.toFixed(1)} s. Ecoute-le, puis enregistre-le.`

      const base = `${slug(project.name)}_${project.bpm}bpm`
      const label = embedded
        ? (canEncodeWebm() ? 'ENREGISTRER (.webm)' : 'ENREGISTRER')
        : 'TELECHARGER LE WAV'
      const saveBtn = h('button', { class: 'xp-btn primary save-audio' }, label)
      saveBtn.addEventListener('click', async () => {
        saveBtn.setAttribute('disabled', 'true')
        await offerAudio(buf, base, (m) => { status.textContent = m },
          (p) => { bar.style.width = `${Math.round(p * 100)}%` })
        saveBtn.removeAttribute('disabled')
      })
      saveRow.appendChild(saveBtn)

      viteau.say('Rendu fini ! Ecoute-le avant de l\'envoyer a un label.')
      fresh.removeAttribute('disabled')
      fresh.textContent = 'Regraver'
    } catch (e) {
      status.textContent = `Echec du rendu : ${String(e)}`
      fresh.removeAttribute('disabled')
      fresh.textContent = 'Reessayer'
    }
  })
}

/* Enregistrement en direct de la sortie master */
function toggleLiveRec() {
  const clearBtns = () => document.querySelectorAll('.btn.rec').forEach((b) => b.classList.remove('on'))
  if (engine.recording) {
    const r = engine.stopRec()
    clearBtns()
    if (!r) { toast('Rien n\'a ete capture.'); return }
    const actx = engine.ctx!
    const buf = actx.createBuffer(2, r.l.length, r.rate)
    buf.copyToChannel(r.l, 0)
    buf.copyToChannel(r.r, 1)
    void offerAudio(buf, `${slug(project.name)}_live`, (m) => toast(m))
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
  nightcore = new Nightcore(ctx)
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

  mk('rack', 'Channel Rack', 'rack', rack.el, 106, 8, 660, 320)
  mk('roll', 'Piano roll', 'piano', roll.el, 330, 210, 720, 400, () => roll.resize())
  mk('playlist', 'Playlist', 'playlist', playlist.el, 150, 344, 780, 292, () => playlist.resize())
  mk('mixer', 'Mixeur', 'mixer', mixer.el, 786, 8, 620, 560)
  mk('channel', 'Reglages du channel', 'wrench', chEditor.el, 200, 88, 620, 470)
  mk('browser', 'Navigateur de samples', 'folder', browser.el, 120, 60, 380, 420)
  mk('nightcore', 'Nightcorification', 'moon', nightcore.el, 190, 34, 880, 630, () => nightcore.refresh())

  for (const id of ['roll', 'mixer', 'browser', 'channel', 'nightcore']) wins.get(id)!.close()

  /* --- menu Demarrer --- */
  const fileInput = h('input', { type: 'file', accept: '.vidaw,.json,application/json', style: { display: 'none' } })
  fileInput.addEventListener('change', () => {
    const f = (fileInput as HTMLInputElement).files?.[0]
    if (f) void importProjectFile(f)
    ;(fileInput as HTMLInputElement).value = ''
  })
  document.body.appendChild(fileInput)

  const entries: MenuEntry[] = [
    { icon: 'moon', label: 'Nightcorification', sub: 'accelerer un morceau', onClick: () => wins.get('nightcore')!.restore() },
    { sep: true, icon: '', label: '' },
    { icon: 'rack', label: 'Channel Rack', sub: 'le sequenceur', onClick: () => wins.get('rack')!.restore() },
    { icon: 'piano', label: 'Piano roll', sub: 'les notes', onClick: () => wins.get('roll')!.restore() },
    { icon: 'playlist', label: 'Playlist', sub: 'arranger le morceau', onClick: () => wins.get('playlist')!.restore() },
    { icon: 'mixer', label: 'Mixeur & effets', onClick: () => wins.get('mixer')!.restore() },
    { icon: 'wrench', label: 'Reglages du channel', onClick: () => wins.get('channel')!.restore() },
    { icon: 'folder', label: 'Navigateur de samples', onClick: () => wins.get('browser')!.restore() },
    { sep: true, icon: '', label: '' },
    { icon: 'floppy', label: 'Enregistrer', sub: 'dans le navigateur', onClick: saveLocal },
    { icon: 'up', label: 'Recharger', sub: 'la derniere sauvegarde', onClick: loadLocal },
    { icon: 'down', label: 'Exporter le projet', sub: 'avec les samples', onClick: () => void exportProjectFile() },
    { icon: 'doc', label: 'Ouvrir un projet', sub: 'fichier .vidaw', onClick: () => fileInput.click() },
    { icon: 'note', label: 'Exporter le morceau', sub: 'rendu audio', onClick: exportDialog },

    { icon: 'newdoc', label: 'Nouveau projet', right: true, onClick: () => {
      dialog({
        title: 'Nouveau projet', icon: 'newdoc',
        body: 'On efface tout et on recommence ? Le projet actuel sera perdu s\'il n\'est pas enregistre.',
        buttons: [
          { label: 'Oui, tout casser', primary: true, onClick: () => { adoptProject(demoProject()); toast('Nouveau projet.') } },
          { label: 'Non' },
        ],
      })
    } },
    { icon: 'dice', label: 'Beat aleatoire', right: true, onClick: () => rack.randomize() },
    { icon: 'star', label: 'Viteau', sub: 'l\'assistant', right: true, onClick: () => {
      const on = viteau.toggle()
      toast(on ? 'Viteau active.' : 'Viteau baillonne.')
    } },
    { icon: 'sleep', label: 'Economiseur d\'ecran', right: true, onClick: () => saver.start() },
    { icon: 'keyboard', label: 'Raccourcis clavier', right: true, onClick: showHelp },
    { icon: 'help', label: 'A propos', right: true, onClick: showAbout },
  ]

  const taskbar = new Taskbar(entries, 'DJ Viteau')
  for (const win of wins.values()) {
    win.taskBtn = taskbar.addButton(win.opts.icon, win.opts.title, () => win.toggle())
    win.opts.onClose = () => { /* le bouton reste, il rouvre la fenetre */ }
  }

  /* --- icones du bureau --- */
  const shortcuts: [string, string, string][] = [
    ['moon', 'Nightcorification', 'nightcore'],
    ['rack', 'Poste de travail', 'rack'],
    ['piano', 'Piano roll', 'roll'],
    ['folder', 'Mes Samples', 'browser'],
    ['mixer', 'Mixeur', 'mixer'],
  ]
  shortcuts.forEach(([ic, lb, target], i) => {
    const el = desktopIcon(ic, lb, 14, 10 + i * 82, () => wins.get(target)!.restore())
    if (target === 'nightcore') el.classList.add('star')
    desktop.appendChild(el)
  })
  desktop.appendChild(desktopIcon('trash', 'Corbeille', 14, 10 + shortcuts.length * 82, () => {
    dialog({ title: 'Corbeille', icon: 'trash', body: 'La corbeille contient 0 element. Et trois maquettes de 2003.' })
  }))

  /* --- le coin du webmaster : badges 88x31 et compteur de visites,
         soit exactement ce qu'on collait en bas d'une page en 2001 --- */
  const badge = (top: string, bot: string, cls: string) =>
    h('a', { class: `badge ${cls}`, title: `${top} ${bot}` },
      h('b', {}, top), h('i', {}, bot))
  const hits = String(137 + Math.floor(Math.random() * 60)).padStart(6, '0')
  desktop.appendChild(h('div', { id: 'webring' },
    h('div', { class: 'wr-strip' }, 'SITE EN CONSTRUCTION'),
    h('div', { class: 'wr-badges' },
      badge('MADE ON', 'A PC', 'b1'),
      badge('BEST WITH', '1024x768', 'b2'),
      badge('NO PLUGIN', 'REQUIRED', 'b3'),
      badge('POWERED BY', 'DJ VITEAU', 'b4'),
    ),
    h('div', { class: 'wr-counter' },
      h('span', {}, 'VISITEURS'),
      h('div', { class: 'odometer' }, ...hits.split('').map((d) => h('u', {}, d)))),
    h('div', { class: 'wr-ring' }, '« precedent · webring DAW · suivant »'),
  ))

  installWallpaper(desktop)

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
    title: 'Raccourcis clavier', icon: 'keyboard',
    body: h('table', { style: { borderCollapse: 'collapse', width: '100%' } },
      ...rows.map(([k, v]) => h('tr', {},
        h('td', { style: { padding: '3px 10px 3px 0', fontWeight: '700', whiteSpace: 'nowrap' } }, k),
        h('td', { style: { padding: '3px 0' } }, v)))),
  })
}

function showAbout() {
  dialog({
    title: 'A propos de DJ ViDAW', icon: 'disk',
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
    } else if (k === 'F6') {
      e.preventDefault()
      if (engine.playing && engine.mode === 'song') engine.stop()
      else { engine.stop(); void engine.play('song') }
    } else if (k === 'Escape') {
      engine.stop()
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
    const proj = files.find((f) => /\.(vidaw|json)$/i.test(f.name))
    if (proj) { void importProjectFile(proj); return }
    // Un seul morceau depose : il y a deux destinations plausibles, on demande.
    if (files.length === 1) {
      dialog({
        title: 'On en fait quoi ?', icon: 'moon',
        body: h('div', {}, h('b', {}, files[0].name), h('div', { style: { marginTop: '6px' } },
          'Le decouper dans le sequenceur, ou l\'accelerer en nightcore ?')),
        buttons: [
          { label: 'Nightcorifier', primary: true, onClick: () => {
            wins.get('nightcore')!.restore()
            void nightcore.load(files[0])
          } },
          { label: 'Importer comme sample', onClick: () => {
            wins.get('browser')!.restore()
            void browser.importFiles(files)
          } },
        ],
      })
      return
    }
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
  setTimeout(() => viteau.say('Bienvenue dans DJ ViDAW ! Appuie sur ESPACE, ca fait du bruit.'), 900)
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
engine.onState = () => transport.paint()
engine.onError = (m) => toast(m)

// Rechargement automatique de la derniere session, si elle existe
if (localStorage.getItem(SAVE_KEY)) {
  setTimeout(() => {
    dialog({
      title: 'Session precedente', icon: 'folder',
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
