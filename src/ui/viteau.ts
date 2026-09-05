/* ============================================================
   DJ ViDAW — L'ASSISTANT VITEAU
   L'heritier spirituel du trombone. Il commente, il conseille,
   il derange. On peut le virer, il revient.
   ============================================================ */

import { h } from './dom'

const FACES = ['🕺', '🪩', '😎', '🤖', '👽', '🦆', '🎧', '🐸']

const IDLE = [
  'Tu sais que tu peux glisser un fichier audio direct sur la fenetre ? Essaie avec la voix de ta mere.',
  'Petit conseil de pro : le bouton HASARD dans le Channel Rack fait 80% du boulot.',
  'Le BITCRUSH a 3 bits, c\'est pas un bug, c\'est une esthetique.',
  'Appuie sur ESPACE. Ca joue. Revolutionnaire.',
  'Si ca sature, baisse le master. Ou pas. Je suis pas ton pere.',
  'Le SWING au dela de 0.3 c\'est plus du groove, c\'est un probleme medical.',
  'Astuce : maj+clic sur un potard pour le reglage fin. Voila, tu es ingenieur du son.',
  'Chope un sample, mets INVERSE, ajoute de la reverbe. Tu viens d\'inventer un genre.',
  'J\'ai vu ton pattern. Je dis rien. Mais j\'ai vu.',
  'Tu peux exporter en WAV depuis le menu DEMARRER. Puis le mettre sur MySpace.',
  'F5 pour jouer le motif, F6 pour la chanson entiere. Comme dans le vrai.',
  'Le TRANCE GATE sur une nappe : instantanement 2003.',
  'Ctrl+molette dans le piano roll pour zoomer. De rien.',
  'Alt+clic sur la forme d\'onde pour poser une tranche. Puis ETALER. Puis MELANGER. Puis genie.',
  'Ce logiciel a ete teste sur un Pentium III. Il a survecu.',
  'Tu as pense a sauvegarder ? Le menu DEMARRER > Enregistrer. Ca va dans ton navigateur.',
  'Les vrais mettent le kick sur tous les temps. Les autres inventent le jazz.',
]

const ON_PLAY = [
  'Ca part ! 🔥', 'Vas-y monte le son.', 'Je sens le tube.', 'Bon... c\'est un debut.',
  'La basse est un peu timide non ?', 'Oui. OUI. OUIII.',
]

export class Viteau {
  el: HTMLElement
  private bubble: HTMLElement
  private body: HTMLElement
  private hideTimer = 0
  private idleTimer = 0
  private face = 0
  enabled = true

  constructor() {
    this.bubble = h('div', { class: 'vt-bubble' })
    this.body = h('div', { class: 'vt-body', onclick: () => this.poke() }, FACES[0])
    this.el = h('div', { class: 'viteau hide', id: 'viteau' }, this.bubble, this.body)
    this.scheduleIdle()
  }

  private scheduleIdle() {
    clearTimeout(this.idleTimer)
    this.idleTimer = window.setTimeout(() => {
      if (this.enabled) this.say(IDLE[Math.floor(Math.random() * IDLE.length)])
      this.scheduleIdle()
    }, 42000 + Math.random() * 30000)
  }

  poke() {
    this.face = (this.face + 1) % FACES.length
    this.body.textContent = FACES[this.face]
    this.say(IDLE[Math.floor(Math.random() * IDLE.length)])
  }

  playQuip() { this.say(ON_PLAY[Math.floor(Math.random() * ON_PLAY.length)], 4200) }

  say(msg: string, ms = 9000) {
    if (!this.enabled) return
    this.bubble.innerHTML = ''
    this.bubble.append(
      h('span', { class: 'vt-close', onclick: () => this.hide(), title: 'Chut' }, '✕'),
      h('b', {}, 'VITEAU : '),
      document.createTextNode(msg),
    )
    this.el.classList.remove('hide')
    clearTimeout(this.hideTimer)
    this.hideTimer = window.setTimeout(() => this.hide(), ms)
  }

  hide() { this.el.classList.add('hide') }

  toggle() {
    this.enabled = !this.enabled
    if (this.enabled) this.say('Je suis de retour. Vous m\'avez manque.')
    else this.hide()
    return this.enabled
  }
}
