// the privacy scan every recorded take passes before it enters the cut: the text a cast prints (inline images cut
// out) or a file of page text, read against the house's banned keywords, the strings given in TRAILER_PRIVATE
// (comma separated: a machine's name, an account), and the shapes that never belong in a public video.
//   TRAILER_PRIVATE=a,b bun trailer/comfy-ts/film/scan.ts <file…>
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'

const repo = resolve(import.meta.dir, '../../..')
const words = (file: string): string[] =>
   existsSync(file)
      ? readFileSync(file, 'utf8')
           .split('\n')
           .map((l) => l.replace(/#.*$/, '').trim())
           .filter((l) => l.length >= 3)
      : []
const banned = [
   ...words(join(homedir(), '.shipkit/private/banned-keywords.txt')),
   ...words(join(repo, '.shipkit/private/banned-keywords.txt')),
   ...(process.env.TRAILER_PRIVATE ?? '').split(',').map((s) => s.trim()).filter(Boolean),
].map((w) => w.toLowerCase())
const shapes: [string, RegExp][] = [
   ['a home folder path', /\/Users\/|\/home\/[a-z]/i],
   ['a tailnet name', /\.ts\.net\b/i],
   ['a tailnet or LAN address', /\b(100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])|192\.168|10)\.\d{1,3}\.\d{1,3}\b/],
   ['a Windows user path', /[A-Z]:\\Users\\/i],
   ['a token shape', /\b(sk|ghp|gho|xox[bp])[-_][A-Za-z0-9]{12,}/],
]
// the model files a take may name: the public Comfy Cloud catalog's, and the staged project's own
const catalog = readFileSync(join(repo, 'examples/comfy-cloud/sdk.d.ts'), 'utf8')
const stage = readFileSync(join(import.meta.dir, '../stage/scenery.cflow.ts'), 'utf8')
const knownModel = (name: string): boolean => catalog.includes(`'${name}'`) || stage.includes(`'${name}'`)

const textOf = (file: string): string => {
   const raw = readFileSync(file, 'utf8')
   const body = file.endsWith('.cast')
      ? raw
           .split('\n')
           .slice(1)
           .filter(Boolean)
           .map((l) => (JSON.parse(l) as [number, string, string])[2])
           .join('')
      : raw
   return body.replace(/\u001b\]1337;File=[^:]*:[A-Za-z0-9+/=]*\u0007/g, '').replace(/\u001b_G[^\u001b]*\u001b\\/g, '')
}

let bad = 0
for (const file of process.argv.slice(2)) {
   const text = textOf(file)
   const low = text.toLowerCase()
   const found: string[] = []
   for (const w of banned) if (low.includes(w)) found.push(`a banned or private word (${w.length} letters, at ${low.indexOf(w)})`)
   for (const [what, rx] of shapes) if (rx.test(text)) found.push(`${what}: ${JSON.stringify(text.match(rx)?.[0])}`)
   for (const m of text.matchAll(/[\w.\\/-]+\.(safetensors|ckpt|pt|gguf)\b/g)) if (!knownModel(m[0].split(/[\\/]/).pop() ?? m[0])) found.push(`a model file outside the public catalog: ${m[0]}`)
   console.log(found.length === 0 ? `clean  ${file}` : `FOUND  ${file}\n   ${found.join('\n   ')}`)
   bad += found.length
}
process.exit(bad === 0 ? 0 : 1)
