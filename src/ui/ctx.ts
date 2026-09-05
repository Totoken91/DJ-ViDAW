import type { Project, Channel } from '../core/state'
import type { Engine } from '../audio/engine'
import type { Samples } from '../audio/samples'

export interface Ctx {
  project: Project
  engine: Engine
  samples: Samples
  /** Rafraichit toutes les vues abonnees. */
  refresh(what?: 'all' | 'rack' | 'roll' | 'playlist' | 'mixer' | 'browser'): void
  /** Applique les changements de mixage/FX au graphe live. */
  sync(): void
  selectChannel(id: string): void
  selected: string
  openWindow(id: string): void
  toast(msg: string): void
  say(msg: string): void
  dialog(o: { title: string; icon?: string; body: HTMLElement | string; buttons?: { label: string; primary?: boolean; onClick?: () => void }[] }): void
  /** Presente un rendu audio : ecoute immediate puis enregistrement. */
  offerRender(buf: AudioBuffer, base: string, title?: string): void
  markDirty(): void
  channel(id: string): Channel | undefined
}
