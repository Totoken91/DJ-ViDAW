/* ============================================================
   DJ ViDAW — NAVIGATEUR DE SAMPLES
   Import par glisser-deposer ou par bouton, enregistrement micro,
   et generateurs de sons idiots (sinus, bruit, sirene...).
   ============================================================ */

import { h, clear } from './dom'
import { icon } from './icons'
import { emptyState } from './shell'
import type { Ctx } from './ctx'
import type { StoredSample } from '../audio/samples'
import { makeChannel } from '../core/state'

export class Browser {
  el: HTMLElement
  private list: HTMLElement
  private recBtn: HTMLElement
  private rec: { stop: () => void } | null = null

  constructor(private ctx: Ctx) {
    this.list = h('div', { class: 'smp-list' })
    const input = h('input', { type: 'file', accept: 'audio/*', multiple: 'true', style: { display: 'none' } })
    input.addEventListener('change', () => {
      const f = (input as HTMLInputElement).files
      if (f) void this.importFiles([...f])
      ;(input as HTMLInputElement).value = ''
    })

    const drop = emptyState({
      icon: 'folder', drop: true,
      title: 'GLISSE TES FICHIERS AUDIO ICI',
      line: 'wav · mp3 · ogg · flac — ou clique pour choisir.',
      onClick: () => input.click(),
    })

    const stop = (e: Event) => { e.preventDefault(); e.stopPropagation() }
    for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { stop(e); drop.classList.add('hover') })
    for (const t of ['dragleave', 'drop']) drop.addEventListener(t, (e) => { stop(e); drop.classList.remove('hover') })
    drop.addEventListener('drop', (e) => {
      const dt = (e as DragEvent).dataTransfer
      if (dt?.files.length) void this.importFiles([...dt.files])
    })

    this.recBtn = h('button', { class: 'btn tiny rec', onclick: () => void this.toggleMic() }, icon('mic'), 'MICRO')

    this.el = h('div', { class: 'browser' },
      h('div', { class: 'bar thin' },
        h('span', { class: 'hint' }, 'IMPORTER'),
        h('div', { class: 'spacer' }),
        this.recBtn,
        h('button', { class: 'btn tiny', onclick: () => input.click() }, icon('folder'), 'FICHIER'),
      ),
      drop,
      h('div', { class: 'bar thin', style: { flexWrap: 'wrap' } },
        h('span', { class: 'hint' }, 'GENERER'),
        h('button', { class: 'btn xs', onclick: () => this.gen('sine') }, '〜 SINUS'),
        h('button', { class: 'btn xs', onclick: () => this.gen('noise') }, '▓ BRUIT'),
        h('button', { class: 'btn xs', onclick: () => this.gen('siren') }, 'SIRENE'),
        h('button', { class: 'btn xs', onclick: () => this.gen('vinyl') }, 'VINYLE'),
        h('button', { class: 'btn xs', onclick: () => this.gen('dial') }, 'MODEM 56K'),
        h('button', { class: 'btn xs', onclick: () => this.gen('error') }, 'ERREUR XP'),
      ),
      this.list, input,
    )
    ctx.samples.onChange = () => this.render()
    this.render()
  }

  async importFiles(files: File[]) {
    const c = this.ctx
    const ctxA = await c.engine.init()
    let ok = 0
    for (const f of files) {
      if (!/audio|\.(wav|mp3|ogg|flac|m4a|aac|opus|webm)$/i.test(f.type + f.name)) continue
      try { await c.samples.addFile(ctxA, f); ok++ }
      catch { c.toast(`Impossible de lire ${f.name}`) }
    }
    if (ok) {
      c.toast(`${ok} sample${ok > 1 ? 's' : ''} importe${ok > 1 ? 's' : ''} !`)
      c.say('Sample charge ! Clique dessus pour creer un channel, puis va le decouper.')
    }
    this.render()
  }

  private async toggleMic() {
    const c = this.ctx
    if (this.rec) { this.rec.stop(); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } })
      const mr = new MediaRecorder(stream)
      const chunks: Blob[] = []
      mr.ondataavailable = (e) => chunks.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        this.rec = null
        this.recBtn.classList.remove('on')
        clear(this.recBtn); this.recBtn.append(icon('mic'), document.createTextNode('MICRO'))
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' })
        try {
          const actx = await c.engine.init()
          const buf = await actx.decodeAudioData(await blob.arrayBuffer())
          c.samples.add(`MICRO ${new Date().toLocaleTimeString('fr-FR')}`, buf)
          c.say('Enregistre ! Maintenant mets-le a l\'envers avec un bitcrush, tu me remercieras.')
        } catch { c.toast('Impossible de decoder l\'enregistrement.') }
      }
      mr.start()
      this.rec = { stop: () => mr.stop() }
      this.recBtn.classList.add('on')
      clear(this.recBtn); this.recBtn.append(icon('stop'), document.createTextNode('STOP'))
      c.toast('Enregistrement en cours... Dis un truc bete.')
    } catch {
      c.toast('Micro refuse ou indisponible.')
    }
  }

  private async gen(kind: string) {
    const c = this.ctx
    const actx = await c.engine.init()
    const rate = actx.sampleRate
    const dur = kind === 'dial' ? 3.2 : kind === 'vinyl' ? 2 : kind === 'error' ? 0.7 : 1.4
    const n = Math.floor(rate * dur)
    const buf = actx.createBuffer(1, n, rate)
    const d = buf.getChannelData(0)
    const env = (i: number) => Math.min(1, i / (rate * 0.01)) * Math.pow(1 - i / n, 0.6)

    for (let i = 0; i < n; i++) {
      const t = i / rate
      let v = 0
      switch (kind) {
        case 'sine': v = Math.sin(2 * Math.PI * 220 * t) * env(i); break
        case 'noise': v = (Math.random() * 2 - 1) * env(i); break
        case 'siren': v = Math.sin(2 * Math.PI * (600 + 380 * Math.sin(2 * Math.PI * 1.6 * t)) * t) * env(i) * 0.7; break
        case 'vinyl': {
          const crackle = Math.random() < 0.0016 ? (Math.random() * 2 - 1) : 0
          v = (Math.random() * 2 - 1) * 0.045 + crackle * 0.85
          break
        }
        case 'dial': {
          if (t < 0.45) v = Math.sin(2 * Math.PI * 350 * t) * 0.4 + Math.sin(2 * Math.PI * 440 * t) * 0.4
          else if (t < 1.5) {
            const step = Math.floor((t - 0.45) * 9)
            const f = [697, 770, 852, 941, 1209, 1336, 1477][step % 7]
            v = (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * (f * 1.72) * t)) * 0.34
          } else {
            v = (Math.random() * 2 - 1) * 0.4
              + Math.sin(2 * Math.PI * (1100 + 700 * Math.sin(2 * Math.PI * 7 * t)) * t) * 0.32
              + Math.sin(2 * Math.PI * 2100 * t) * 0.18
          }
          v *= Math.min(1, (n - i) / (rate * 0.15))
          break
        }
        case 'error': {
          const f = t < 0.16 ? 880 : t < 0.32 ? 660 : 523
          v = (Math.sin(2 * Math.PI * f * t) * 0.5 + Math.sin(2 * Math.PI * f * 1.5 * t) * 0.2) * env(i)
          break
        }
      }
      d[i] = Math.max(-1, Math.min(1, v))
    }
    const names: Record<string, string> = { sine: 'SINUS 220', noise: 'BRUIT BLANC', siren: 'SIRENE', vinyl: 'VINYLE', dial: 'MODEM 56K', error: 'ERREUR XP' }
    c.samples.add(names[kind] ?? kind, buf)
    c.toast(`${names[kind]} genere`)
  }

  render() {
    const c = this.ctx
    clear(this.list)
    const items = c.samples.list()
    if (!items.length) {
      this.list.appendChild(h('div', { class: 'hint', style: { textAlign: 'center', padding: '14px' } },
        'Aucun sample. Importe un fichier, enregistre-toi, ou genere un bruit debile ci-dessus.'))
      return
    }
    for (const s of items) this.list.appendChild(this.row(s))
  }

  private row(s: StoredSample): HTMLElement {
    const c = this.ctx
    const assign = () => {
      // priorite : channel sampler selectionne, sinon on en cree un
      let ch = c.channel(c.selected)
      if (!ch || ch.type !== 'sampler') {
        ch = c.project.channels.find((x) => x.type === 'sampler' && !x.sampler?.sampleId)
      }
      if (!ch) {
        ch = makeChannel('sampler', s.name, c.project.channels.length)
        c.project.channels.push(ch)
      }
      ch.sampler!.sampleId = s.id
      ch.sampler!.start = 0
      ch.sampler!.end = 1
      ch.sampler!.slices = []
      ch.name = s.name.toUpperCase().slice(0, 18)
      c.markDirty(); c.sync(); c.refresh('all')
      c.selectChannel(ch.id)
      c.openWindow('channel')
    }

    const preview = async () => {
      const actx = await c.engine.init()
      const src = actx.createBufferSource()
      src.buffer = s.buffer
      const g = actx.createGain(); g.gain.value = 0.8
      src.connect(g).connect(actx.destination)
      src.start()
      setTimeout(() => { try { src.stop() } catch { /* deja fini */ } }, Math.min(4000, s.duration * 1000 + 60))
    }

    return h('div', { class: 'smp', ondblclick: assign },
      icon('wave', 13),
      h('span', { class: 'nm', title: s.name }, s.name),
      h('span', { class: 'dur' }, `${s.duration.toFixed(2)}s`),
      h('button', { class: 'btn xs', onclick: (e: Event) => { e.stopPropagation(); void preview() } }, '▶'),
      h('button', { class: 'btn xs go', onclick: (e: Event) => { e.stopPropagation(); assign() } }, 'CHARGER'),
      h('button', {
        class: 'btn xs', onclick: (e: Event) => {
          e.stopPropagation()
          for (const ch of c.project.channels) if (ch.sampler?.sampleId === s.id) ch.sampler.sampleId = null
          c.samples.remove(s.id); c.markDirty(); c.refresh('all')
        },
      }, '✕'),
    )
  }
}
