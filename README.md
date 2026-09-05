```
 ____      _  __     ___ ____    ___        __
|  _ \    | | \ \   / (_)  _ \  / \ \      / /
| | | |_  | |  \ \ / /| | | | |/ _ \ \ /\ / /
| |_| | |_| |   \ V / | | |_| / ___ \ V  V /
|____/ \___/     \_/  |_|____/_/   \_\_/\_/
```

# DJ ViDAW

**Une station de travail audionumérique complète qui tient dans un onglet.**
Par *DJ Viteau*. Interface Windows XP / FL Studio / Y2K, moteur audio écrit à la main.

Tout le son est fabriqué en direct par le navigateur : il n'y a **aucun fichier audio
dans ce dépôt**. Les percussions, le synthé, les effets, le jingle de démarrage et
même le bruit de modem 56k sont synthétisés par des oscillateurs.

---

## Démarrer

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # typecheck + bundle dans dist/
npm run preview    # sert le bundle de production
```

Aucune dépendance à l'exécution. Vite et TypeScript servent uniquement à la
construction. Le résultat est un dossier statique de ~150 Ko.

---

## Ce qu'il y a dedans

### Le moteur audio

| Brique | Détail |
|---|---|
| **Transport** | Scheduler à fenêtre glissante : un timer imprécis place les événements sur l'horloge audio, qui elle ne dérive pas. Swing sur les doubles-croches impaires. |
| **Percussions** | 10 modèles entièrement synthétisés (kick, snare, clap, hat, open hat, tom, rim, cowbell, crash, zap) avec tune / decay / tone / snap / drive. |
| **Synthé** | Soustractif : 2 oscillateurs (scie, carré, sinus, triangle, bruit), unison jusqu'à 5 voix avec détune et largeur stéréo, sous-octave, filtre résonant à enveloppe, ADSR, glide. 6 presets. |
| **Sampler** | Import par glisser-déposer, fenêtre début/fin, lecture inversée, boucle, calage au tempo, découpe en tranches (manuelle, en 4/8/16, ou par détection de transitoires), note de base pour jouer le sample au piano roll. |
| **Effets** | 9 unités, 6 par insert : filtre à LFO, delay ping-pong synchronisé, réverbe à convolution (impulsion générée), bitcrusher (AudioWorklet), distorsion à repli, chorus, phaser, EQ 3 bandes, compresseur, trance gate. |
| **Mixeur** | 9 inserts + master, routage libre des channels, pan, vu-mètres, limiteur de sortie. |
| **Export** | Rendu **hors-ligne** dans un `OfflineAudioContext` reconstruit à l'identique, puis encodage WAV 16 bits. Ce que tu exportes est ce que tu entends. Enregistrement de la sortie en direct également possible. |

Le point clé de l'architecture : le graphe audio et les voix sont écrits contre
`BaseAudioContext`, jamais contre `AudioContext`. Le même code sert donc à la
lecture temps réel et au bounce hors-ligne — pas de second moteur à maintenir,
pas de divergence entre l'écoute et le fichier exporté.

### L'interface

Un faux Windows XP, reconstruit intégralement en CSS : **zéro image binaire**.
Le fond d'écran, les barres de titre Luna, le bouton démarrer, les potards, les
vu-mètres et les curseurs sont des dégradés, des `radial-gradient` et des SVG
en `data:` URI.

- **Channel Rack** — séquenceur pas à pas, vélocité au clic droit ou à la molette
- **Piano roll** — dessin, déplacement, redimensionnement, gomme, bandeau de vélocité, quantisation, arpégiateur
- **Playlist** — arrangement des motifs sur 10 pistes, avec aperçu des notes dans les clips
- **Mixeur** — tranches, rack d'effets, vu-mètres
- **Réglages du channel** — s'adapte au type : percussion, sampler avec forme d'onde, ou synthé
- **Navigateur de samples** — import, micro, et générateurs de bruits idiots
- **Fenêtres** déplaçables, redimensionnables, minimisables, avec barre des tâches
- **Viteau**, l'assistant, qui commente pendant que tu travailles
- Économiseur d'écran après 90 secondes d'inactivité

---

## Raccourcis

| Touche | Effet |
|---|---|
| `Espace` / `F5` | Jouer ou arrêter le motif |
| `F6` | Jouer ou arrêter la chanson (playlist) |
| `Échap` | Tout arrêter |
| `Ctrl+S` | Enregistrer dans le navigateur |
| `Ctrl+R` | Beat aléatoire |
| `1` … `9` | Sélectionner un channel |
| Clic droit sur un pas | Changer la vélocité |
| Molette sur un potard | Réglage · `Maj` pour le mode fin |
| Double-clic sur un potard | Valeur par défaut |
| `Ctrl`+molette | Zoom (piano roll, playlist) |
| `Alt`+clic sur la forme d'onde | Poser une tranche |

---

## Fichiers de projet

- **Ctrl+S** enregistre dans le `localStorage` du navigateur (sans les samples).
- **Exporter le projet** produit un `.vidaw` : du JSON contenant le projet **et**
  tous les samples encodés en WAV base64. Autonome, transportable.
- Un `.vidaw` glissé sur la fenêtre est rechargé directement.

Rien ne quitte jamais ta machine : il n'y a aucun serveur.

---

## Structure

```
src/
├─ core/state.ts        modèle de projet, presets, définitions des effets
├─ audio/
│  ├─ voices.ts         synthèse des percussions, sampler, synthé
│  ├─ fx.ts             les 9 effets, en fabriques reconstructibles
│  ├─ graph.ts          câblage channels → inserts → master
│  ├─ engine.ts         transport et scheduler
│  ├─ render.ts         bounce hors-ligne et encodage WAV
│  └─ samples.ts        décodage, pics d'affichage, détection de transitoires
├─ worklets/            bitcrusher et tap d'enregistrement (JS pur)
├─ ui/                  fenêtres, séquenceur, piano roll, playlist, mixeur…
└─ styles/              xp.css (Luna) · daw.css (FL) · goofy.css (Y2K)
```

---

## Compatibilité

Chrome, Edge, Firefox et Safari récents. Le bitcrusher utilise un `AudioWorklet`
et retombe sur un `WaveShaper` si le worklet ne charge pas. Le son ne peut
démarrer qu'après un clic — c'est une règle des navigateurs, d'où l'écran de
démarrage.

---

*« Si ça clippe, c'est que c'est bien. » — DJ Viteau*
