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
npm run build            # typecheck + bundle dans dist/
npm run preview          # sert le bundle de production
npm run build:artifact   # page unique auto-portante dans dist/artifact.html
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

### Le mode Nightcorification

Un applet complet, dans sa propre fenêtre, accessible depuis le bureau. On y
dépose un morceau et on le transforme.

Le nightcore, techniquement, c'est une bande magnétique qu'on accélère : la
hauteur monte **avec** la vitesse. Le « slowed + reverb » est exactement le même
effet dans l'autre sens. Le mode **RUBAN** reproduit ça exactement — un simple
`playbackRate`, donc aucune dégradation. Le mode **LIBRE** découple vitesse et
hauteur par recouvrement de grains fenêtrés ; c'est utile quand on veut
accélérer sans effet chipmunk, mais ça grésille un peu, et c'est annoncé comme
tel dans l'interface plutôt que caché.

- **Huit presets** : nightcore (1.30x), nightcore doux, hyper, ralenti + reverb,
  vaporwave, 8D, chipmunk, et « rapide, voix intacte » (mode libre).
- **Chaîne dédiée** : pleurage de bande (deux LFO désaccordés sur un retard
  court), coupe-bas, plateaux grave et aigu, saturation, élargisseur mi/latéral,
  panoramique automatique « 8D », réverbe à convolution, limiteur.
- **Lecture en direct** avec forme d'onde, tête de lecture, et boucle qu'on
  trace à la souris.
- **Affichage** de la vitesse, de la hauteur en demi-tons, de la durée
  d'origine → durée finale, et du tempo estimé avant/après.
- **Sorties** : export audio par rendu hors-ligne (même chaîne, donc identique à
  l'écoute), ou envoi direct comme channel sampler pour le découper dans le
  séquenceur.

### L'interface

Un faux Windows XP, reconstruit intégralement en CSS : **zéro image binaire**.
Le fond d'écran lui-même est calculé — ciel dégradé, nuages en bruit
fractionnaire éclairés par le haut, collines herbeuses texturées, brume
d'horizon et grain argentique — rendu une fois au démarrage dans un canevas
(`src/ui/wallpaper.ts`). Pour y mettre une vraie photo à la place :
`installWallpaper(desktop, { photo: '…' })`, avec une URL ou une `data:` URI
(le CSP des pages embarquées bloque les images externes, donc il faut
l'embarquer).
Le fond d'écran, les barres de titre Luna, le bouton démarrer, les potards, les
vu-mètres et les curseurs sont des dégradés, des `radial-gradient` et des SVG
en `data:` URI.

Les icônes sont dessinées à la main sur une grille de 16 (`src/ui/icons.ts`),
en aplats cernés : c'est la grammaire des icônes de 2001, et les emoji — qui
n'existaient pas encore — cassaient l'illusion plus sûrement que n'importe quel
autre détail. Viteau, l'assistant, est dessiné lui aussi : une tête de CD sous
un casque, avec six expressions.

Le vert néon ne signifie qu'une chose : **actif**. L'ambre est la couleur des
afficheurs, le rose celle des actions qui sortent du logiciel, le rouge
l'enregistrement. Une couleur qui veut tout dire ne dit rien.

En bas du bureau, des badges 88×31, un compteur de visites à roulettes et un
anneau de sites — ce qu'on collait vraiment en bas d'une page en 2001.

- **Channel Rack** — séquenceur pas à pas, vélocité au clic droit ou à la molette
- **Piano roll** — dessin, déplacement, redimensionnement, gomme, bandeau de vélocité, quantisation, arpégiateur
- **Playlist** — arrangement des motifs sur 10 pistes, avec aperçu des notes dans les clips
- **Mixeur** — tranches, rack d'effets, vu-mètres
- **Réglages du channel** — s'adapte au type : percussion, sampler avec forme d'onde, ou synthé
- **Nightcorification** — l'applet décrit plus haut, avec sa propre identité
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

Dans la Nightcorification : clic sur la forme d'onde pour se placer, glisser
pour tracer une boucle, clic droit pour l'enlever.

---

## Fichiers de projet

- **Ctrl+S** enregistre dans le `localStorage` du navigateur (sans les samples).
- **Exporter le projet** produit un `.vidaw` : du JSON contenant le projet **et**
  tous les samples encodés en WAV base64. Autonome, transportable.
- Un `.vidaw` (ou `.json`) glissé sur la fenêtre est rechargé directement.

Rien ne quitte jamais ta machine : il n'y a aucun serveur.

## Page unique et pages embarquées

`npm run build:artifact` produit `dist/artifact.html` : un seul fichier, CSS et
JS compris, sans aucune ressource externe. Les AudioWorklets sont chargés depuis
une Blob URL construite à partir de leur source, donc il n'y a pas de chemin
d'asset à résoudre — et si l'hôte interdit les Blob URL, le bitcrusher retombe
sur un `WaveShaper`.

Quand la page tourne dans un viewer qui intercepte les téléchargements
(`window.claude` présent), l'export s'adapte :

| | Page autonome | Page embarquée |
|---|---|---|
| Écoute du rendu | lecteur intégré | lecteur intégré |
| Fichier audio | `.wav` par lien de téléchargement | `.webm` (Opus) via la capacité `downloads` de l'hôte |
| Fichier de projet | `.vidaw` | `.json` (même contenu) |

Le WAV n'est pas dans la liste d'extensions que ces hôtes acceptent, d'où
l'encodage webm — fait en temps réel par `MediaRecorder`, avec une barre de
progression.

---

## Structure

```
src/
├─ core/state.ts        modèle de projet, presets, définitions des effets
├─ audio/
│  ├─ voices.ts         synthèse des percussions, sampler, synthé
│  ├─ nightcore.ts      chaîne nightcore, étirement temporel, rendu
│  ├─ fx.ts             les 9 effets, en fabriques reconstructibles
│  ├─ graph.ts          câblage channels → inserts → master
│  ├─ engine.ts         transport et scheduler
│  ├─ render.ts         bounce hors-ligne et encodage WAV
│  └─ samples.ts        décodage, pics d'affichage, détection de transitoires
├─ worklets/            bitcrusher et tap d'enregistrement (JS pur)
├─ ui/                  fenêtres, séquenceur, piano roll, playlist, mixeur…
│  ├─ icons.ts          le jeu d'icônes et la mascotte, en SVG
│  └─ nightcore.ts      l'applet Nightcorification
└─ styles/              xp.css (Luna) · daw.css (FL) · goofy.css (Y2K)
                        nightcore.css (l'applet)
```

---

## Compatibilité

Chrome, Edge, Firefox et Safari récents. Le bitcrusher utilise un `AudioWorklet`
et retombe sur un `WaveShaper` si le worklet ne charge pas. Le son ne peut
démarrer qu'après un clic — c'est une règle des navigateurs, d'où l'écran de
démarrage.

---

*« Si ça clippe, c'est que c'est bien. » — DJ Viteau*
