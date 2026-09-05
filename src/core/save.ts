/* ============================================================
   DJ ViDAW — SAUVEGARDE DE FICHIERS
   Selon l'endroit ou la page tourne, on ne sort pas un fichier de
   la meme facon :
   - page normale : un lien <a download>
   - page embarquee dans un viewer (artefact claude.ai) : le lien est
     inerte, il faut passer par la capacite "downloads" de l'hote, qui
     n'accepte qu'une liste d'extensions (wav n'en fait pas partie).
   ============================================================ */

interface DownloadsNs {
  save(r: { filename: string; data: Blob | string | ArrayBuffer }): Promise<{ status: string }>
}
interface ClaudeHost { use(name: string): Promise<unknown> }

const host = (): ClaudeHost | null => {
  const w = window as unknown as { claude?: ClaudeHost }
  return w.claude && typeof w.claude.use === 'function' ? w.claude : null
}

/** Vrai si la page est encapsulee par un hote qui intercepte les telechargements. */
export const isEmbedded = () => host() !== null

let cached: Promise<DownloadsNs | null> | null = null
function downloads(): Promise<DownloadsNs | null> {
  const h = host()
  if (!h) return Promise.resolve(null)
  if (!cached) cached = h.use('downloads').then((d) => (d as DownloadsNs | null) ?? null).catch(() => null)
  return cached
}

/** Extensions que l'hote accepte. Le WAV n'y est pas : il faut du webm. */
export const HOST_AUDIO_EXT = 'webm'

export type SaveResult =
  | { ok: true }
  | { ok: false; reason: 'declined' | 'unsupported' | 'unavailable' | 'error'; message: string }

export async function saveFile(blob: Blob, filename: string): Promise<SaveResult> {
  const d = await downloads()

  if (d) {
    try {
      await d.save({ filename, data: blob })
      return { ok: true }
    } catch (e) {
      const code = (e as { code?: string })?.code ?? 'error'
      if (code === 'declined') return { ok: false, reason: 'declined', message: 'Enregistrement annule.' }
      if (code === 'rejected_extension' || code === 'extension_not_enabled') {
        return { ok: false, reason: 'unsupported', message: `Cet hote n'accepte pas les fichiers .${filename.split('.').pop()}.` }
      }
      return { ok: false, reason: 'error', message: (e as { message?: string })?.message ?? 'Enregistrement impossible.' }
    }
  }

  if (isEmbedded()) {
    return { ok: false, reason: 'unavailable', message: 'Cet hote ne permet pas d\'enregistrer de fichier.' }
  }

  // Page autonome : le lien de telechargement classique
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return { ok: true }
}
