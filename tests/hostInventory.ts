import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'pathe'
import type { ShippedText } from 'tests/shippedFiles.ts'

/**
 * The core of tests/no-host-inventory.test.ts, pure so the guard is proven on synthetic data.
 *
 * The leak class: a live `object_info` entry, a Manager list or a ws frame captured into a fixture,
 * a doc or a test carries the combo values of the host it came from: its lora files, its
 * checkpoints, that person's whole collection. Two rules:
 *
 * - inventory shape, cache free: a file listing more than MAX_UNKNOWN_MODEL_NAMES model file names
 *   that no TRACKED public catalog carries. Tracked sources only, so a clone and CI judge alike.
 * - private host names, where a host cache exists: a name the host has and no public source carries
 *   is host only. A host only LORA name in any file fails; more than MAX_HOST_MODEL_NAMES other host
 *   only names in one file outside `examples/` fail (an example names the models it loads on purpose).
 *
 * Never print a host only name: `maskName` everywhere a name reaches a message.
 */

export const MODEL_EXTENSIONS = ['safetensors', 'ckpt', 'pth', 'pt', 'gguf', 'bin', 'sft', 'onnx']

/** a hand-written fixture documents a few cases; a real capture lists dozens to hundreds */
export const MAX_UNKNOWN_MODEL_NAMES = 12
/** one doc or test naming a model or two is a mention; more in one place is a capture */
export const MAX_HOST_MODEL_NAMES = 3
/** a lora stem shorter than this is a word, not a name: below it only the full file name counts */
const MIN_STEM_CHARS = 8

/** public models no tracked catalog carries, each checked by hand: lowercase basename, then where anyone downloads it */
export const PUBLIC_MODEL_NAMES: [name: string, url: string][] = []

/** the files whose names are public by construction: the committed cloud catalog and the Manager's model list */
export const PUBLIC_CATALOG_FILES = [
   'examples/comfy-cloud/sdk.d.ts',
   'src/manager/json/model-list.json',
   'src/manager/json/model-list.extra.ts',
]

/** a host id whose cache is the shared cloud catalog, public by construction */
export const PUBLIC_HOST_IDS = new Set(['comfy-cloud'])

const EXT_AT_END = new RegExp(`\\.(?:${MODEL_EXTENSIONS.join('|')})$`)
const EXT_ANCHOR = new RegExp(`\\.(?:${MODEL_EXTENSIONS.join('|')})(?![a-z0-9])`, 'g')
/** where a quoted or path-like file name starts */
const NAME_START = new Set([...'"\'`<>|\\/:\n\r\t'].map((c) => c.charCodeAt(0)))
/** where a name inside prose starts: the same, plus spaces and punctuation */
const TOKEN_START = new Set([...' ,;()[]{}=*'].map((c) => c.charCodeAt(0)))

export function basenameOf(path: string): string {
   return (path.split(/[\\/]/).pop() ?? path).toLowerCase()
}

/** first four characters and the length: enough to find it, never enough to read it */
export function maskName(name: string): string {
   const b = basenameOf(name)
   return `${b.slice(0, 4)}…(${b.length} chars)`
}

/**
 * every model file name written in a text, lowercase basenames: for each extension, the run back
 * to a quote or a path separator (a name with spaces), and the run back to a space (prose)
 */
export function modelNamesInText(text: string): { wide: Set<string>; tokens: Set<string> } {
   const lower = text.toLowerCase()
   const wide = new Set<string>()
   const tokens = new Set<string>()
   for (const m of lower.matchAll(EXT_ANCHOR)) {
      const end = m.index + m[0].length
      let a = m.index
      let tokenStart = -1
      while (a > 0 && !NAME_START.has(lower.charCodeAt(a - 1))) {
         if (tokenStart < 0 && TOKEN_START.has(lower.charCodeAt(a - 1))) tokenStart = a
         a--
      }
      if (a === m.index) continue
      wide.add(lower.slice(a, end).trim())
      const t = tokenStart < 0 ? a : tokenStart
      if (t < m.index) tokens.add(lower.slice(t, end))
   }
   return { wide, tokens }
}

/** every string with a model extension anywhere in a parsed json value, lowercase basenames */
export function modelNamesInJson(value: unknown, out: Set<string> = new Set()): Set<string> {
   if (typeof value === 'string') {
      const b = basenameOf(value)
      if (EXT_AT_END.test(b)) out.add(b)
   } else if (Array.isArray(value)) for (const v of value) modelNamesInJson(v, out)
   else if (value != null && typeof value === 'object') for (const v of Object.values(value)) modelNamesInJson(v, out)
   return out
}

export type HostNames = { hostIds: string[]; models: Set<string>; loras: Set<string> }

/** what a host's cache says it holds: every model name its object_info lists, and which of them are loras */
export function addHostCache(into: HostNames, hostId: string, objectInfo: unknown, lorasMirror: unknown): void {
   into.hostIds.push(hostId)
   modelNamesInJson(objectInfo, into.models)
   const nodes = (objectInfo ?? {}) as Record<string, { input?: { required?: Record<string, unknown> } } | undefined>
   for (const cls of ['LoraLoader', 'LoraLoaderModelOnly'])
      for (const n of modelNamesInJson(nodes[cls]?.input?.required?.lora_name)) into.loras.add(n)
   const items = (lorasMirror as { loras?: Record<string, { file_path?: unknown }> } | null)?.loras ?? {}
   for (const item of Object.values(items))
      if (typeof item.file_path === 'string') into.loras.add(basenameOf(item.file_path))
   for (const n of into.loras) into.models.add(n)
}

/** every private host cache under `<root>/.comfy-ts/hosts/`, the cloud catalog left out */
export function readHostCaches(root: string): HostNames {
   const out: HostNames = { hostIds: [], models: new Set(), loras: new Set() }
   const dir = join(root, '.comfy-ts', 'hosts')
   if (!existsSync(dir)) return out
   for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || PUBLIC_HOST_IDS.has(entry.name)) continue
      const oiPath = join(dir, entry.name, 'object_info.json')
      if (!existsSync(oiPath)) continue
      const lmPath = join(dir, entry.name, 'loras.json')
      const lm: unknown = existsSync(lmPath) ? JSON.parse(readFileSync(lmPath, 'utf8')) : null
      addHostCache(out, entry.name, JSON.parse(readFileSync(oiPath, 'utf8')), lm)
   }
   return out
}

/** the names the local cloud catalog cache and the template corpus carry, when this machine has them */
export function readLocalPublicNames(root: string): Set<string> {
   const out = new Set<string>()
   for (const id of PUBLIC_HOST_IDS) {
      const p = join(root, '.comfy-ts', 'hosts', id, 'object_info.json')
      if (existsSync(p)) for (const n of modelNamesInText(readFileSync(p, 'utf8')).wide) out.add(basenameOf(n))
   }
   const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
         const p = join(dir, entry.name)
         if (entry.isDirectory()) walk(p)
         else if (entry.name.endsWith('.json'))
            for (const n of modelNamesInText(readFileSync(p, 'utf8')).wide) out.add(basenameOf(n))
      }
   }
   const templates = join(root, '.comfy-ts', 'templates')
   if (existsSync(templates)) walk(templates)
   return out
}

/** public names from tracked text only: the same answer on every machine */
export function trackedPublicNames(texts: ShippedText[]): { basenames: Set<string>; tokens: Set<string> } {
   const basenames = new Set<string>()
   const tokens = new Set<string>()
   for (const [name] of PUBLIC_MODEL_NAMES) {
      basenames.add(name)
      for (const t of modelNamesInText(name).tokens) tokens.add(t)
   }
   for (const t of texts) {
      if (!PUBLIC_CATALOG_FILES.includes(t.file)) continue
      const found = modelNamesInText(t.text)
      for (const n of found.wide) basenames.add(basenameOf(n))
      for (const n of found.tokens) tokens.add(n)
   }
   return { basenames, tokens }
}

type Needle = { name: string; form: string }

/** name characters: `[a-z0-9_.+-]` and every non ascii letter */
const NAME_CHAR = new Uint8Array(128)
for (const c of 'abcdefghijklmnopqrstuvwxyz0123456789_.+-') NAME_CHAR[c.charCodeAt(0)] = 1
const isNameChar = (c: number): boolean => c >= 128 || NAME_CHAR[c] === 1
const isTrailing = (c: number): boolean => c === 46 || c === 95 || c === 43 || c === 45 // . _ + -

function headOf(form: string): string {
   let i = 0
   while (i < form.length && isNameChar(form.charCodeAt(i))) i++
   return form.slice(0, i)
}

/**
 * finds host only names in a text by runs of name characters, so a lora stem that is only a piece
 * of a longer model name never matches. A lora also matches by its stem alone: a prompt writes
 * `<lora:stem:0.8>`, a mirror strips the extension, a preview is `<stem>.png`.
 * One pass per text; a run is sliced only when its length can be a needle's.
 */
export class HostNameMatcher {
   private byHead = new Map<string, Needle[]>()
   private headLengths = new Set<number>()

   constructor(p: { models: Iterable<string>; loras: Set<string> }) {
      for (const name of p.models) {
         const forms = [name]
         const stem = name.replace(EXT_AT_END, '')
         if (p.loras.has(name) && stem.replaceAll(/[^a-z0-9]/g, '').length >= MIN_STEM_CHARS) forms.push(stem)
         for (const form of forms) {
            const head = headOf(form)
            if (head === '') continue
            const list = this.byHead.get(head) ?? []
            list.push({ name, form })
            this.byHead.set(head, list)
            this.headLengths.add(head.length)
         }
      }
   }

   /** the host only names a text spells, lowercase basenames */
   find(text: string, hits: Set<string> = new Set()): Set<string> {
      if (this.byHead.size === 0) return hits
      const lower = text.toLowerCase()
      const n = lower.length
      let i = 0
      while (i < n) {
         if (!isNameChar(lower.charCodeAt(i))) {
            i++
            continue
         }
         const a = i
         while (i < n && isNameChar(lower.charCodeAt(i))) i++
         // the run itself, the run without trailing punctuation, the run without its last extension
         let t = i
         while (t > a && isTrailing(lower.charCodeAt(t - 1))) t--
         let dot = t - 1
         while (dot > a && lower.charCodeAt(dot) !== 46) dot--
         this.tryKey(lower, a, i, i, hits)
         if (t !== i) this.tryKey(lower, a, t, i, hits)
         if (dot > a) this.tryKey(lower, a, dot, i, hits)
      }
      return hits
   }

   private tryKey(lower: string, a: number, end: number, runEnd: number, hits: Set<string>): void {
      if (!this.headLengths.has(end - a)) return
      const key = lower.slice(a, end)
      const needles = this.byHead.get(key)
      if (needles == null) return
      for (const nd of needles) {
         if (nd.form === key) hits.add(nd.name)
         else if (end === runEnd && lower.startsWith(nd.form, a)) {
            const after = lower.charCodeAt(a + nd.form.length)
            if (Number.isNaN(after) || after === 46 || !isNameChar(after)) hits.add(nd.name)
         }
      }
   }
}

export type Finding = { file: string; what: string; names: string[] }

export function isAuthoredExample(file: string): boolean {
   return file.startsWith('examples/') && !PUBLIC_CATALOG_FILES.includes(file)
}

/** cache free: files that list more model names than a hand-written case needs, none of them public */
export function inventoryFindings(texts: ShippedText[], publicTokens: Set<string>): Finding[] {
   const out: Finding[] = []
   for (const t of texts) {
      if (PUBLIC_CATALOG_FILES.includes(t.file)) continue
      const unknown = [...modelNamesInText(t.text).tokens].filter((n) => !publicTokens.has(n))
      if (unknown.length > MAX_UNKNOWN_MODEL_NAMES)
         out.push({
            file: t.file,
            what: `${unknown.length} model file names no tracked public catalog carries (an inventory)`,
            names: unknown,
         })
   }
   return out
}

/**
 * host only names in shipped files. `latePublic` is the costly public source (the template
 * corpus): read only when a file would fail without it, so a clean tree never pays for it.
 */
export function hostNameFindings(
   texts: ShippedText[],
   host: HostNames,
   publicNames: Set<string>,
   latePublic: () => Set<string> = () => new Set(),
): Finding[] {
   const pub = new Set(publicNames)
   let matcher = new HostNameMatcher({ models: [...host.models].filter((n) => !pub.has(n)), loras: host.loras })
   let lateRead = false
   const judge = (file: string, names: Set<string>): Finding[] => {
      const loras = [...names].filter((n) => host.loras.has(n))
      const models = [...names].filter((n) => !host.loras.has(n))
      const out: Finding[] = []
      if (loras.length > 0)
         out.push({ file, what: `${loras.length} lora file names only a private host has`, names: loras })
      if (models.length > MAX_HOST_MODEL_NAMES && !isAuthoredExample(file))
         out.push({
            file,
            what: `${models.length} model file names only a private host has (a captured combo)`,
            names: models,
         })
      return out
   }
   const out: Finding[] = []
   const findIn = (t: ShippedText): Set<string> => matcher.find(t.text, matcher.find(t.file))
   for (const t of texts) {
      let found = findIn(t)
      if (judge(t.file, found).length > 0 && !lateRead) {
         lateRead = true
         const late = latePublic()
         if (late.size > 0) {
            for (const n of late) pub.add(n)
            matcher = new HostNameMatcher({ models: [...host.models].filter((n) => !pub.has(n)), loras: host.loras })
            found = findIn(t)
         }
      }
      out.push(...judge(t.file, found))
   }
   return out
}

export function formatFindings(findings: Finding[]): string {
   if (findings.length === 0) return ''
   const lines = findings.map((f) => {
      const samples = f.names.slice(0, 5).map(maskName).join(', ')
      return `  ${f.file}: ${f.what}, e.g. ${samples}`
   })
   return [
      `a shipped file carries the model inventory of a host (names masked):`,
      ...lines,
      `fix: replace the captured values with synthetic ones (tests/fixtures/lm-loras-list.synthetic.json is the model) and drop the capture.`,
      `a real public model: add its lowercase basename and its download url to PUBLIC_MODEL_NAMES in tests/hostInventory.ts.`,
   ].join('\n')
}
