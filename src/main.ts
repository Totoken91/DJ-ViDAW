/* ============================================================
   DJ ViDAW v1.0
   par DJ Viteau — un DAW complet dans un onglet, habille en 2001.
   ============================================================ */

import './styles/xp.css'
import './styles/daw.css'
import './styles/goofy.css'
import './styles/nightcore.css'
import './styles/synth.css'

import { h, clear } from './ui/dom'
import { Win, type Geometry } from './ui/win'
import { Rack } from './ui/rack'
import { PianoRoll } from './ui/pianoroll'
import { Playlist } from './ui/playlist'
import { Mixer } from './ui/mixer'
import { ChannelEditor } from './ui/channel'
import { Browser } from './ui/browser'
import { Nightcore } from './ui/nightcore'
import { Transport } from './ui/transport'
import { Viteau } from './ui/viteau'
import { dialog, closeDialog, toast, Taskbar, Saver, desktopIcon, type MenuEntry } from './ui/shell'
import { boot } from './ui/boot'
import { icon } from './ui/icons'
import { installWallpaper } from './ui/wallpaper'
import type { Ctx } from './ui/ctx'

import { Engine } from './audio/engine'
import { Samples } from './audio/samples'
import { renderProject, bufferToWav, bufferToWebm, canEncodeWebm } from './audio/render'
import { saveFile, isEmbedded, type SaveResult } from './core/save'
import { emptyProject, migrateProject, type Project, clamp } from './core/state'

/* ------------------------------------------------------------------ */
/* Etat global                                                         */
/* ------------------------------------------------------------------ */

const SAVE_KEY = 'vidaw.project.v1'
const LAYOUT_KEY = 'vidaw.layout.v1'
const SEEN_KEY = 'vidaw.seen.v1'

let project: Project = emptyProject()
const samples = new Samples()
const engine = new Engine(project, samples)

const app = document.getElementById('app')!
const desktop = h('div', { id: 'desktop' })
const viteau = new Viteau()
const saver = new Saver()

let rack: Rack, roll: PianoRoll, playlist: Playlist, mixer: Mixer, chEditor: ChannelEditor, browser: Browser, transport: Transport, nightcore: Nightcore
const wins = new Map<string, Win>()
let dirty = false

/* ------------------------------------------------------------------ */
/* Historique : instantanes du projet, pour annuler et refaire          */
/* ------------------------------------------------------------------ */

const undoStack: string[] = []
const redoStack: string[] = []
let snapTimer = 0
let lastSnap = ''

/** Empile l'etat d'avant la derniere salve de modifications. */
function pushSnapshot() {
  window.clearTimeout(snapTimer)
  const cur = JSON.stringify(project)
  if (cur === lastSnap) return
  if (lastSnap) {
    undoStack.push(lastSnap)
    if (undoStack.length > 80) undoStack.shift()
    redoStack.length = 0
  }
  lastSnap = cur
}

/** Remplace le projet sans reconstruire le contexte audio : le graphe
    sait ajouter et retirer les channels a chaud. */
function applyProject(p: Project) {
  project = p
  ctx.project = p
  engine.project = p
  if (!p.channels.find((c) => c.id === ctx.selected)) ctx.selected = p.channels[0]?.id ?? ''
  engine.sync()
  ctx.refresh('all')
  ctx.selectChannel(ctx.selected)
}

function undo() {
  pushSnapshot()
  const prev = undoStack.pop()
  if (!prev) { toast('Rien a annuler.'); return }
  redoStack.push(JSON.stringify(project))
  lastSnap = prev
  applyProject(migrateProject(JSON.parse(prev) as Project))
  dirty = true
  toast(`Annule (${undoStack.length} etape${undoStack.length > 1 ? 's' : ''} restante${undoStack.length > 1 ? 's' : ''})`)
}

function redo() {
  const next = redoStack.pop()
  if (!next) { toast('Rien a retablir.'); return }
  undoStack.push(JSON.stringify(project))
  lastSnap = next
  applyProject(migrateProject(JSON.parse(next) as Project))
  dirty = true
  toast('Retabli.')
}

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
  markDirty() {
    dirty = true
    // les instantanes sont regroupes : tourner un potard ne cree pas
    // cinquante etapes d'annulation
    window.clearTimeout(snapTimer)
    snapTimer = window.setTimeout(pushSnapshot, 400)
  },
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
    const p = migrateProject(JSON.parse(raw) as Project)
    if (!p.channels?.length) throw new Error('vide')
    adoptProject(p)
    toast(`Projet "${p.name}" recharge.`)
  } catch { toast('Fichier de sauvegarde illisible.') }
}

/* ------------------------------------------------------------------ */
/* Disposition des fenetres                                            */
/* ------------------------------------------------------------------ */

let layoutTimer = 0
function saveLayout() {
  window.clearTimeout(layoutTimer)
  layoutTimer = window.setTimeout(() => {
    const out: Record<string, unknown> = {}
    for (const [id, w] of wins) out[id] = w.geometry()
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(out)) } catch { /* stockage plein */ }
  }, 500)
}

function loadLayout() {
  const raw = localStorage.getItem(LAYOUT_KEY)
  if (!raw) return false
  try {
    const data = JSON.parse(raw) as Record<string, Partial<Geometry>>
    for (const [id, g] of Object.entries(data)) wins.get(id)?.setGeometry(g)
    return true
  } catch { return false }
}

function cascade() {
  const host = desktop.getBoundingClientRect()
  const list = [...wins.values()].filter((w) => w.open)
  list.forEach((w, i) => {
    const x = 24 + i * 30, y = 12 + i * 28
    w.place(x, y, Math.min(820, host.width - x - 24), Math.min(520, host.height - y - 24))
  })
  list.at(-1)?.focus()
  saveLayout()
}

/** Range les fenetres ouvertes en grille, sans recouvrement. */
function tile() {
  const host = desktop.getBoundingClientRect()
  const list = [...wins.values()].filter((w) => w.open && !w.el.classList.contains('minimized'))
  if (!list.length) { toast('Aucune fenetre ouverte.'); return }
  const cols = Math.ceil(Math.sqrt(list.length))
  const rows = Math.ceil(list.length / cols)
  const cw = Math.floor(host.width / cols), chh = Math.floor(host.height / rows)
  list.forEach((w, i) => {
    w.place((i % cols) * cw, Math.floor(i / cols) * chh, cw - 2, chh - 2)
  })
  saveLayout()
}

function defaultLayout() {
  const host = desktop.getBoundingClientRect()
  const fit = (x: number, y: number, w: number, hh: number) =>
    [Math.min(x, Math.max(8, host.width - w - 8)), Math.min(y, Math.max(8, host.height - 60)),
     Math.min(w, host.width - 16), Math.min(hh, host.height - 16)] as const
  const set = (id: string, x: number, y: number, w: number, hh: number, open: boolean) => {
    const win = wins.get(id)
    if (!win) return
    const [a, b, c, d] = fit(x, y, w, hh)
    win.place(a, b, c, d)
    if (!open) win.close()
  }
  set('rack', 106, 8, 680, 330, true)
  set('playlist', 150, 348, 800, 290, true)
  set('roll', 330, 210, 740, 410, false)
  set('mixer', 790, 8, 620, 570, false)
  set('channel', 170, 74, 800, 600, false)
  set('browser', 120, 60, 390, 430, false)
  set('nightcore', 190, 34, 890, 630, false)
  saveLayout()
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
    const p = migrateProject(data.project as Project)
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
              x: number, y: number, w: number, hh: number, onResize?: () => void, status?: string) => {
    const win = new Win({
      id, title, icon,
      x: Math.min(x, Math.max(10, W - w - 10)), y: Math.min(y, Math.max(10, H - 80)),
      w: Math.min(w, W - 20), h: Math.min(hh, H - 10),
      onResize, onGeometry: saveLayout,
    }, desktop)
    win.body.appendChild(content)
    if (status) win.setStatusBar(status)
    wins.set(id, win)
    return win
  }

  mk('rack', 'Channel Rack', 'rack', rack.el, 106, 8, 690, 348, undefined,
     'Clic pour poser un pas · clic droit ou molette pour la velocite · double-clic sur un nom pour le piano roll')
  mk('roll', 'Piano roll', 'piano', roll.el, 330, 210, 740, 410, () => roll.resize(),
     'Clic pour poser une note · glisser son bord droit pour la longueur · Ctrl+molette pour zoomer')
  mk('playlist', 'Playlist', 'playlist', playlist.el, 150, 348, 800, 300, () => playlist.resize(),
     'Clic pour poser un motif · clic droit pour effacer · glisser pour deplacer · Maj+molette pour les pistes')
  mk('mixer', 'Mixeur', 'mixer', mixer.el, 790, 8, 620, 570, undefined,
     'Choisis une tranche, puis ajoute ses effets en dessous')
  mk('channel', 'Instrument', 'wrench', chEditor.el, 170, 74, 860, 620, () => chEditor.resize(),
     'F2 rouvre cette fenetre · sur un synthetiseur, le clavier de l\'ordinateur joue les notes')
  mk('browser', 'Navigateur de samples', 'folder', browser.el, 120, 60, 390, 430, undefined,
     'Glisse un fichier audio n\'importe ou sur le bureau pour l\'importer')
  mk('nightcore', 'Nightcorification', 'moon', nightcore.el, 190, 34, 890, 630, () => nightcore.refresh(),
     'Clic sur la forme d\'onde pour se placer · glisser pour tracer une boucle · clic droit pour l\'enlever')

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
    { icon: 'wrench', label: 'Instrument', sub: 'synthe, sampler, percussion', onClick: () => wins.get('channel')!.restore() },
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
          { label: 'Oui, tout casser', primary: true, onClick: () => { adoptProject(emptyProject()); toast('Nouveau projet.') } },
          { label: 'Non' },
        ],
      })
    } },
    { icon: 'dice', label: 'Beat aleatoire', right: true, onClick: () => rack.randomize() },
    { icon: 'playlist', label: 'Ranger les fenetres', sub: 'en grille', right: true, onClick: tile },
    { icon: 'doc', label: 'Fenetres en cascade', right: true, onClick: cascade },
    { icon: 'screen', label: 'Disposition d\'origine', right: true, onClick: defaultLayout },
    { icon: 'star', label: 'Viteau', sub: 'l\'assistant', right: true, onClick: () => {
      const on = viteau.toggle()
      toast(on ? 'Viteau active.' : 'Viteau baillonne.')
    } },
    { icon: 'sleep', label: 'Economiseur d\'ecran', right: true, onClick: () => saver.start() },
    { icon: 'star', label: 'Premiers pas', right: true, onClick: showWelcome },
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

  // Le paysage coute ~200 ms de calcul : on le peint pendant que l'ecran
  // de demarrage occupe l'affichage, sinon il saccade son animation.
  const paintWall = () => installWallpaper(desktop)
  if ('requestIdleCallback' in window) {
    (window as Window & { requestIdleCallback(cb: () => void, o?: { timeout: number }): number })
      .requestIdleCallback(paintWall, { timeout: 1200 })
  } else setTimeout(paintWall, 450)

  app.append(transport.el, desktop, taskbar.el, taskbar.menu, viteau.el, saver.el)

  ctx.selectChannel(ctx.selected)
  transport.scope.analyser = engine.graph?.analyser ?? null
  loadLayout()
  lastSnap = JSON.stringify(project)
  if (!localStorage.getItem(SEEN_KEY)) showWelcome()
  requestAnimationFrame(() => { transport.scope.resize(); roll.resize(); playlist.resize() })
}

/* ------------------------------------------------------------------ */
/* Premiers pas — le projet demarre vide, il faut une porte d'entree    */
/* ------------------------------------------------------------------ */

let welcomeEl: HTMLElement | null = null

function showWelcome() {
  welcomeEl?.remove()
  const step = (title: string, body: string, action?: { label: string; run: () => void }) =>
    h('li', {},
      h('b', {}, title),
      h('span', {}, body),
      action ? h('button', { class: 'btn tiny go', onclick: action.run }, action.label) : null)

  welcomeEl = h('div', { id: 'welcome', role: 'complementary', 'aria-label': 'Premiers pas' },
    h('div', { class: 'wc-head' },
      icon('star', 16),
      h('span', {}, 'PREMIERS PAS'),
      h('button', {
        class: 'wc-x', 'aria-label': 'Fermer', title: 'Fermer',
        onclick: () => { welcomeEl?.remove(); welcomeEl = null; try { localStorage.setItem(SEEN_KEY, '1') } catch { /* rien */ } },
      }, '✕')),
    h('ol', {},
      step('Pose un rythme', 'Clique les cases du Channel Rack. Chaque ligne est un instrument.',
        { label: 'M\'en generer un', run: () => { wins.get('rack')!.restore(); rack.randomize() } }),
      step('Ecoute', 'Barre ESPACE pour lancer et arreter le motif.'),
      step('Change les sons', 'Ouvre l\'Instrument : le synthetiseur a 36 presets prets a l\'emploi.',
        { label: 'Ouvrir le synthe', run: () => { const sy = project.channels.find((c) => c.type === 'synth'); if (sy) ctx.selectChannel(sy.id); wins.get('channel')!.restore() } }),
      step('Arrange et exporte', 'Peins tes motifs dans la Playlist, puis EXPORTER en haut a droite.'),
    ),
    h('div', { class: 'wc-foot' }, 'Appuie sur ', h('kbd', {}, '?'), ' a tout moment pour la liste des raccourcis.'),
  )
  desktop.appendChild(welcomeEl)
}

/* ------------------------------------------------------------------ */
/* Boites d'aide                                                       */
/* ------------------------------------------------------------------ */

function showHelp() {
  const groups: [string, [string, string][]][] = [
    ['Transport', [
      ['Espace / F5', 'Jouer ou arreter le motif'],
      ['F6', 'Jouer ou arreter la chanson'],
      ['Echap', 'Tout arreter (ou fermer la boite ouverte)'],
    ]],
    ['Edition', [
      ['Ctrl + Z', 'Annuler'],
      ['Ctrl + Maj + Z', 'Retablir'],
      ['Ctrl + S', 'Enregistrer dans le navigateur'],
      ['Ctrl + E', 'Exporter le morceau'],
      ['Ctrl + D', 'Dupliquer le motif'],
      ['Ctrl + R', 'Beat aleatoire'],
    ]],
    ['Fenetres', [
      ['Alt + 1 … 7', 'Rack · Piano roll · Playlist · Mixeur · Instrument · Samples · Nightcore'],
      ['F2', 'Ouvrir l\'instrument selectionne'],
      ['Glisser vers un bord', 'Accrocher la fenetre a la moitie ou au quart'],
      ['Double-clic sur le titre', 'Agrandir ou restaurer'],
    ]],
    ['Selection', [
      ['1 … 9', 'Selectionner un channel'],
      ['Tab / Maj + Tab', 'Channel suivant ou precedent'],
      ['?', 'Afficher cette liste'],
    ]],
    ['Souris', [
      ['Clic sur un pas', 'Poser ou retirer une note'],
      ['Clic droit sur un pas', 'Changer la velocite'],
      ['Molette sur un potard', 'Regler · Maj pour le mode fin'],
      ['Double-clic sur un potard', 'Valeur par defaut'],
      ['Ctrl + molette', 'Zoom (piano roll, playlist)'],
      ['Alt + clic sur la forme d\'onde', 'Poser une tranche'],
    ]],
    ['Synthetiseur', [
      ['A/Q S D F G H J K', 'Jouer les touches blanches'],
      ['Z/W E T Y U', 'Jouer les touches noires'],
      ['Fleches haut / bas', 'Changer d\'octave'],
    ]],
  ]
  const body = h('div', { style: { display: 'grid', gap: '10px', maxHeight: '58vh', overflow: 'auto' } })
  for (const [title, rows] of groups) {
    body.append(
      h('div', { style: { font: '700 10px/1.6 Tahoma, sans-serif', letterSpacing: '1.4px', color: '#2b4f8f', textTransform: 'uppercase' } }, title),
      h('table', { style: { borderCollapse: 'collapse', width: '100%' } },
        ...rows.map(([k, v]) => h('tr', {},
          h('td', { style: { padding: '2px 12px 2px 0', fontWeight: '700', whiteSpace: 'nowrap', verticalAlign: 'top' } }, k),
          h('td', { style: { padding: '2px 0' } }, v)))),
    )
  }
  dialog({ title: 'Raccourcis clavier', icon: 'keyboard', body })
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

/* ------------------------------------------------------------------ */
/* Clavier                                                             */
/* ------------------------------------------------------------------ */

/** Fenetres accessibles par Alt + chiffre, dans l'ordre du menu. */
const WIN_KEYS: [string, string][] = [
  ['rack', 'Channel Rack'], ['roll', 'Piano roll'], ['playlist', 'Playlist'],
  ['mixer', 'Mixeur'], ['channel', 'Instrument'], ['browser', 'Samples'],
  ['nightcore', 'Nightcorification'],
]

function selectNeighbour(d: number) {
  const i = project.channels.findIndex((c) => c.id === ctx.selected)
  const n = project.channels.length
  if (!n) return
  const ch = project.channels[((i + d) % n + n) % n]
  ctx.selectChannel(ch.id)
  wins.get('rack')?.el.querySelector<HTMLElement>('.rack-row.sel')?.scrollIntoView({ block: 'nearest' })
}

function bindKeys() {
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement
    const typing = t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)
    const k = e.key
    const mod = e.ctrlKey || e.metaKey

    // Echap ferme d'abord ce qui est ouvert par-dessus
    if (k === 'Escape') {
      const modal = document.getElementById('modal-layer')
      if (modal?.classList.contains('on')) { closeDialog(); return }
      if (!typing) { engine.stop(); return }
    }
    if (typing) return

    /* --- fenetres : Alt + chiffre --- */
    if (e.altKey && /^[1-7]$/.test(k)) {
      e.preventDefault()
      const [id] = WIN_KEYS[Number(k) - 1]
      wins.get(id)?.toggle()
      return
    }

    /* --- edition --- */
    if (mod && k.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo(); else undo()
      return
    }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
    if (mod && k.toLowerCase() === 's') { e.preventDefault(); saveLocal(); return }
    if (mod && k.toLowerCase() === 'r') { e.preventDefault(); rack.randomize(); return }
    if (mod && k.toLowerCase() === 'e') { e.preventDefault(); exportDialog(); return }
    if (mod && k.toLowerCase() === 'd') { e.preventDefault(); playlist.clonePattern(); return }

    /* --- transport --- */
    if (k === ' ' || k === 'F5') {
      e.preventDefault()
      if (engine.playing && engine.mode === 'pattern') engine.stop()
      else { engine.stop(); void engine.play('pattern'); viteau.playQuip() }
      return
    }
    if (k === 'F6') {
      e.preventDefault()
      if (engine.playing && engine.mode === 'song') engine.stop()
      else { engine.stop(); void engine.play('song') }
      return
    }

    /* --- navigation --- */
    if (k === 'Tab') { e.preventDefault(); selectNeighbour(e.shiftKey ? -1 : 1); return }
    if (/^[1-9]$/.test(k)) {
      const ch = project.channels[Number(k) - 1]
      if (ch) ctx.selectChannel(ch.id)
      return
    }
    if (k === '?' || (k === '/' && e.shiftKey)) { e.preventDefault(); showHelp(); return }
    if (k === 'F2') { e.preventDefault(); wins.get('channel')?.restore(); return }
  })

  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return
    e.preventDefault()
    e.returnValue = ''
  })

  /* --- glisser-deposer sur tout le bureau --- */
  const stop = (e: Event) => { e.preventDefault(); e.stopPropagation() }
  for (const t of ['dragenter', 'dragover', 'drop']) document.addEventListener(t, stop)
  document.addEventListener('drop', (e) => {
    const files = [...((e as DragEvent).dataTransfer?.files ?? [])]
    if (!files.length) return
    const proj = files.find((f) => /\.(vidaw|json)$/i.test(f.name))
    if (proj) { void importProjectFile(proj); return }
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

  let resizeTimer = 0
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      transport.scope.resize()
      roll.resize()
      playlist.resize()
    }, 120)
  })
}

/* ------------------------------------------------------------------ */
/* Boucle d'animation                                                  */
/* ------------------------------------------------------------------ */

/** Une fenetre masquee ne merite pas qu'on redessine son canevas. */
const shown = (id: string) => {
  const w = wins.get(id)
  return !!w?.open && !w.el.classList.contains('minimized')
}

let lastStep = -2
let lastInfo = ''
function loop() {
  transport.scope.draw()
  if (shown('mixer')) mixer.tick()

  // La tete de lecture se deduit de l'horloge audio : pas de timer par pas,
  // et le trait avance a la frequence de l'ecran plutot que par a-coups.
  const s = engine.uiStep
  if (s !== lastStep) {
    lastStep = s
    const pat = engine.mode === 'pattern' ? s : -1
    const song = engine.mode === 'song' ? s : -1
    if (shown('rack')) rack.setPlayhead(pat)
    if (shown('roll')) roll.setPlayhead(pat)
    if (shown('playlist')) playlist.setPlayhead(song)
    transport.setPosition(Math.max(0, s))
  }

  const pat = project.patterns.find((x) => x.id === project.currentPattern)
  const info = `${project.bpm} BPM · ${pat ? pat.name : '—'} · ${pat ? pat.bars : 1} MES`
  if (info !== lastInfo) {
    lastInfo = info
    for (const w of wins.values()) w.setInfo(info)
  }
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
