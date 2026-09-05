/* Construit une page unique auto-portante a partir de dist/.
   Le CSS et le JS sont integres au fichier ; il ne reste aucune ressource
   externe a resoudre, ce qui est la condition pour publier en artefact.
   Les balises doctype/html/head/body sont volontairement omises : l'hote
   fournit son propre squelette. */
import fs from 'node:fs'
import path from 'node:path'

const DIST = 'dist'
const OUT = process.argv[2] ?? 'dist/artifact.html'

const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')

const read = (href) => fs.readFileSync(path.join(DIST, href.replace(/^\.?\//, '')), 'utf8')

const cssHrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1])
const jsSrcs = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)].map((m) => m[1])

if (!jsSrcs.length) throw new Error('aucun bundle JS trouve dans dist/index.html')

const title = (html.match(/<title>([^<]*)<\/title>/) ?? [, 'DJ ViDAW'])[1]
const css = cssHrefs.map(read).join('\n')
// Une sequence "</script" fermerait le bloc prematurement, meme dans une chaine.
const js = jsSrcs.map(read).join('\n;\n').replaceAll('</script', '<\\/script')

const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/) ?? [, ''])[1]
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .trim()

const out = `<title>${title}</title>
<style>
${css}
</style>
${body}
<script type="module">
${js}
</script>
`

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, out)
const kb = (Buffer.byteLength(out) / 1024).toFixed(0)
console.log(`${OUT} — ${kb} Ko (css ${(css.length / 1024) | 0} Ko, js ${(js.length / 1024) | 0} Ko)`)
