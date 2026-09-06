/* ============================================================
   DJ ViDAW — TYPOGRAPHIE DES CANEVAS

   Le CSS a ses variables (voir xp.css) ; un canevas, lui, veut une
   chaine. Ces trois fabriques la produisent, avec les MEMES piles de
   polices que le reste de l'interface.

   Ce n'est pas de la coquetterie : un « Tahoma » nu tombe en serif sur
   la plupart des Linux, et la moitie des etiquettes du logiciel se
   retrouvaient dessinees dans une police qui n'a rien a faire la.
   ============================================================ */

const UI = 'Tahoma, "DejaVu Sans", Verdana, sans-serif'
const DISPLAY = '"Trebuchet MS", "DejaVu Sans", Tahoma, sans-serif'
const MONO = '"Courier New", "DejaVu Sans Mono", monospace'

export const FONT = {
  /** Interface : etiquettes, noms, aides. */
  ui: (px: number, weight: number | string = 400) => `${weight} ${px}px ${UI}`,
  /** Titres de module. */
  display: (px: number, weight: number | string = 900) => `${weight} ${px}px ${DISPLAY}`,
  /** Tout ce qui porte un chiffre. */
  mono: (px: number, weight: number | string = 400) => `${weight} ${px}px ${MONO}`,
}
