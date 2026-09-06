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
| **Synthé** | Voir la section dédiée ci-dessous. |
| **Sampler** | Import par glisser-déposer, fenêtre début/fin, lecture inversée, boucle, calage au tempo, découpe en tranches (manuelle, en 4/8/16, ou par détection de transitoires), note de base pour jouer le sample au piano roll. |
| **Effets** | 9 unités, 6 par insert : filtre à LFO, delay ping-pong synchronisé, réverbe à convolution (impulsion générée), bitcrusher (AudioWorklet), distorsion à repli, chorus, phaser, EQ 3 bandes, compresseur, trance gate. |
| **Mixeur** | 9 inserts + master, routage libre des channels, pan, vu-mètres, limiteur de sortie. |
| **Export** | Rendu **hors-ligne** dans un `OfflineAudioContext` reconstruit à l'identique, puis encodage WAV 16 bits. Ce que tu exportes est ce que tu entends. Enregistrement de la sortie en direct également possible. |

Le point clé de l'architecture : le graphe audio et les voix sont écrits contre
`BaseAudioContext`, jamais contre `AudioContext`. Le même code sert donc à la
lecture temps réel et au bounce hors-ligne — pas de second moteur à maintenir,
pas de divergence entre l'écoute et le fichier exporté.

### Le synthétiseur

Un vrai instrument, pas une case à cocher. Chaque voix se construit à la volée
dans le graphe audio, et le même code sert à l'écoute et au rendu hors-ligne.

- **Deux oscillateurs** indépendants : six formes d'onde (dent de scie, carré,
  impulsion à largeur réglable, triangle, sinus, bruit), octave, demi-tons,
  accord fin, niveau, et **unisson jusqu'à 7 voix** par oscillateur avec
  désaccord, dérive analogique et étalement stéréo.
- **Sous-octave** (sinus, triangle ou carré), générateur de **bruit**, et
  **modulation en anneau** entre les deux oscillateurs.
- **Filtre** passe-bas 12 ou 24 dB, passe-haut, passe-bande, coupe-bande, avec
  résonance, saturation en entrée, suivi de clavier et enveloppe dédiée. Sa
  réponse est tracée en direct dans le panneau.
- **Deux enveloppes** ADSR (amplitude et filtre), dessinées elles aussi.
- **Deux LFO** — sinus, triangle, rampe, carré, échantillonneur-bloqueur — en
  Hz libre ou synchronisés au tempo, avec montée progressive et quatre
  destinations chacun : hauteur, filtre, volume, panoramique.
- **Effets intégrés au preset** : saturation, chorus, écho synchronisé et
  réverbe à convolution, montés une fois par channel. C'est ce qui fait qu'un
  preset sonne dès qu'on le charge au lieu de sonner sec.
- **36 presets** répartis en huit familles : basses, leads, plucks, nappes,
  claviers, cloches, arpèges, effets.

Sa face avant est disposée **en flux de signal** — oscillateurs à gauche, filtre
au centre, sortie à droite — sur des plaques de métal vissées à sérigraphie
gravée. La taille d'une commande dit son importance : la fréquence de coupure
est un grand cadran gradué, l'accord fin un bouton de trim. Et surtout, trois
choses y sont vivantes plutôt que numériques :

- **Un oscilloscope branché sur la vraie sortie du channel**, avec spectre,
  synchronisé sur le passage par zéro pour que la trace ne glisse pas.
- **Les deux enveloppes se manipulent par leurs points** : on attrape A, D ou R
  et on tire. Plus de quatre potards à traduire mentalement en courbe.
- **La réponse du filtre est tracée en direct**, la position des LFO tourne sur
  leur forme, et chaque oscillateur montre sa propre onde.
- **Clavier jouable** à la souris et au clavier d'ordinateur (`A/Q S D F G H J K`
  pour les blanches, `Z/W E T Y U` pour les noires), compatible AZERTY et QWERTY.

L'impulsion à largeur variable passe par des tables de Fourier pré-calculées
(Web Audio n'a pas de PWM natif), et la modulation en anneau exploite la
modulation d'un `GainNode` à la fréquence audio.

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

### Le démarrage

Deux écrans, dans l'ordre où ils existaient vraiment :

1. **Le POST du BIOS** — mode texte VGA, aligné à gauche en colonnes, test
   mémoire qui compte, détection des périphériques, logo Energy Star, balayage
   cathodique. `Échap` le passe, comme le propose la ligne du bas.
2. **Le splash du logiciel** — une fenêtre sans bordure : illustration et
   version à gauche, licence, barre de progression segmentée, ligne d'état qui
   défile, mention de copyright. Puis le bouton qui autorise l'audio, parce que
   les navigateurs exigent un geste — ce n'est pas une décoration.

Pas de titre en dégradé arc-en-ciel, pas de bouton pilule qui pulse : ce sont
des tics de page d'accueil moderne, et ils n'ont rien à faire ici.

### Confort d'usage

- **Démarrage sur un projet vierge** : le rack est prêt, aucune note n'est
  posée. Un panneau « Premiers pas » donne les quatre gestes qui comptent, et
  le bouton HASARD génère un rythme si on veut juste entendre quelque chose.
- **Annuler / rétablir** (`Ctrl+Z`, `Ctrl+Maj+Z`) sur tout le projet. Les
  modifications rapprochées sont groupées : tourner un potard ne crée pas
  cinquante étapes.
- **Accrochage des fenêtres** : glisser vers un bord les place en moitié, vers
  un coin en quart, vers le haut en plein écran, avec un aperçu pendant le
  geste. `Ranger les fenêtres` les dispose en grille, `Cascade` les empile.
- **La disposition est mémorisée** entre les sessions.
- `Alt+1` à `Alt+7` ouvrent et ferment chaque fenêtre, `Tab` passe au channel
  suivant, `?` affiche la liste complète des raccourcis.
- Le focus clavier est visible partout, et les animations s'effacent sous
  `prefers-reduced-motion`.
- **Barres d'état** en pied de fenêtre : les aides contextuelles y descendent au
  lieu d'encombrer les barres d'outils, et survoler une commande y affiche ce
  qu'elle fait. La cellule de droite rappelle tempo, motif et longueur.
- Les commandes sont regroupées en **blocs gravés** par famille d'actions —
  une rangée de boutons identiques ne dit rien de leur rôle.
- Dans le séquenceur, la grille laisse voir les temps **avant même de jouer** :
  les pas sur le temps sont plus clairs et chaque groupe de quatre est détaché.

### Détails d'interface

- Le **mixeur** est une console : tranches vissées sur un rail, master
  distingué par sa matière. Chaque effet porte la couleur de sa famille
  (filtre, temps, matière, dynamique) sur sa tranche gauche — on lit une chaîne
  d'un coup d'œil sans lire les noms.
- Le **piano roll** contraste franchement touches noires et blanches, et la
  vélocité y module la luminosité de la note plutôt que d'y ajouter du blanc :
  mélanger vers le blanc désature et efface l'identité du channel.
- Les commandes sont regroupées en **blocs gravés** par famille d'actions.

### Fluidité

La tête de lecture ne dépend plus d'un `setTimeout` par pas : elle se déduit de
l'horloge audio à chaque image, ce qui la rend exacte et supprime des centaines
de timers par minute. Les canevas du piano roll et de la playlist ne sont
redessinés que si leur fenêtre est réellement visible, et le redimensionnement
est temporisé.

### Le système de couleur

Dix teintes arc-en-ciel à saturation maximale ne forment pas une palette, elles
forment une guirlande — et c'est le premier symptôme d'une interface non
dessinée. Tout passe désormais par un système :

- **Neutres** tirés vers le bleu plutôt que du gris pur, sur dix crans. Un
  neutre choisi se voit ; un neutre par défaut se subit.
- **Accents par rôle** : l'ambre est la matière — les pas, les afficheurs, tout
  ce qui porte une valeur ; le bleu désigne la sélection ; le vert ne dit qu'une
  chose, *ça joue* ; le rouge, *ça enregistre*. Rien d'autre ne mérite d'être
  coloré.
- **Identité des channels** : dix teintes de valeur voisine et de saturation
  moyenne, qui servent à distinguer des pistes, pas à décorer.
- Les halos ne signalent plus que ce qui est actif.

Dans le séquenceur, les pas ont donc **une seule couleur** et la vélocité se lit
en luminosité, comme sur un séquenceur matériel. L'identité d'un channel tient
dans sa réglette latérale. Sept teintes saturées côte à côte, c'était une
guirlande.

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
| `Ctrl + Z` / `Ctrl + Maj + Z` | Annuler / rétablir |
| `Alt + 1` … `Alt + 7` | Ouvrir ou fermer une fenêtre |
| `Tab` / `Maj + Tab` | Channel suivant / précédent |
| `?` | La liste complète, dans l'application |
| `Alt`+clic sur la forme d'onde | Poser une tranche |
| `A/Q S D F G H J K` | Jouer le synthé au clavier |

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
│  ├─ synth.ts          le synthétiseur : voix, filtre, LFO, effets
│  ├─ presets.ts        les 36 presets
│  ├─ nightcore.ts      chaîne nightcore, étirement temporel, rendu
│  ├─ fx.ts             les 9 effets, en fabriques reconstructibles
│  ├─ graph.ts          câblage channels → inserts → master
│  ├─ engine.ts         transport et scheduler
│  ├─ render.ts         bounce hors-ligne et encodage WAV
│  └─ samples.ts        décodage, pics d'affichage, détection de transitoires
├─ worklets/            bitcrusher et tap d'enregistrement (JS pur)
├─ ui/                  fenêtres, séquenceur, piano roll, playlist, mixeur…
│  ├─ icons.ts          le jeu d'icônes et la mascotte, en SVG
│  ├─ synth.ts          la face avant du synthétiseur
│  ├─ wallpaper.ts      le paysage calculé
│  └─ nightcore.ts      l'applet Nightcorification
└─ styles/              xp.css (Luna) · daw.css (FL) · goofy.css (Y2K)
                        nightcore.css · synth.css
```

---

## Compatibilité

Chrome, Edge, Firefox et Safari récents. Le bitcrusher utilise un `AudioWorklet`
et retombe sur un `WaveShaper` si le worklet ne charge pas. Le son ne peut
démarrer qu'après un clic — c'est une règle des navigateurs, d'où l'écran de
démarrage.

---

*« Si ça clippe, c'est que c'est bien. » — DJ Viteau*
