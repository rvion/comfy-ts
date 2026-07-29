// compat sweep over .comfy-ts/templates/: classify every downloaded JSON,
// validate litegraph-format ones against LiteGraphJSON_ark, report the gaps.
// REPORT ONLY: this script never fixes anything.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'pathe'
import { type } from 'arktype'
import { LiteGraphJSON_ark } from 'src/litegraph/LiteGraphJSON.ts'

const ROOT = '.comfy-ts/templates'

type Outcome = 'ok' | 'schema-fail' | 'parse-fail' | 'skipped'

type FileResult = {
   file: string
   source: string
   format: string
   outcome: Outcome
   cause?: string
}

function isRecord(x: unknown): x is Record<string, unknown> {
   return typeof x === 'object' && x != null && !Array.isArray(x)
}

function classify(p: { file: string; data: unknown }): string {
   const d = p.data
   if (Array.isArray(d)) return /(^|\/)index(\.[\w-]+)?\.json$/.test(p.file) ? 'index-manifest' : 'array-other'
   if (!isRecord(d)) return 'other'
   if (Array.isArray(d.nodes) && Array.isArray(d.links)) {
      const version = d.version == null ? '?' : String(d.version)
      const isBlueprint = isRecord(d.definitions) || Array.isArray(d.definitions)
      return isBlueprint ? `blueprint (litegraph+defs) v${version}` : `litegraph v${version}`
   }
   const values = Object.values(d)
   if (values.length > 0 && values.every((v) => isRecord(v) && typeof v.class_type === 'string')) return 'api-prompt'
   if (p.file.endsWith('bundles.json')) return 'bundle-manifest'
   if (typeof d.$schema === 'string') return 'json-schema'
   return 'other'
}

// stable cause key: numeric path segments collapse so 500 files share one bucket
function causeKey(p: { path: readonly PropertyKey[]; expected: string }): string {
   const norm = p.path.map((seg) => (/^\d+$/.test(String(seg)) ? '*' : String(seg))).join('.')
   return `${norm === '' ? '(root)' : norm}: expected ${p.expected}`
}

function walk(dir: string): string[] {
   const entries = readdirSync(dir, { recursive: true, encoding: 'utf-8' })
   return entries
      .filter((e) => e.endsWith('.json'))
      .map((e) => join(dir, e))
      .sort()
}

if (!existsSync(ROOT)) {
   throw new Error(`[templates] 🔴 ${ROOT}/ not found. Run \`bun run templates:fetch\` first.`)
}

const results: FileResult[] = []
const causeCount = new Map<string, { count: number; example: string }>()

for (const file of walk(ROOT)) {
   const source = file.slice(ROOT.length + 1).split('/')[0] ?? '?'
   let data: unknown
   try {
      data = JSON.parse(readFileSync(file, 'utf-8'))
   } catch (err) {
      results.push({ file, source, format: 'unparseable', outcome: 'parse-fail', cause: String(err) })
      continue
   }
   const format = classify({ file, data })
   if (!format.startsWith('litegraph') && !format.startsWith('blueprint')) {
      results.push({ file, source, format, outcome: 'skipped' })
      continue
   }
   const out = LiteGraphJSON_ark(data)
   if (out instanceof type.errors) {
      const first = out[0]
      const cause = first == null ? '(no error detail)' : causeKey({ path: first.path, expected: first.expected })
      const entry = causeCount.get(cause)
      if (entry == null) causeCount.set(cause, { count: 1, example: file })
      else entry.count++
      results.push({ file, source, format, outcome: 'schema-fail', cause })
      continue
   }
   results.push({ file, source, format, outcome: 'ok' })
}

// ---- summary table: per source × format ----
type Row = { ok: number; schemaFail: number; parseFail: number; skipped: number }
const rows = new Map<string, Row>()
for (const r of results) {
   const key = `${r.source} | ${r.format}`
   const row = rows.get(key) ?? { ok: 0, schemaFail: 0, parseFail: 0, skipped: 0 }
   if (r.outcome === 'ok') row.ok++
   else if (r.outcome === 'schema-fail') row.schemaFail++
   else if (r.outcome === 'parse-fail') row.parseFail++
   else row.skipped++
   rows.set(key, row)
}

const keyWidth = Math.max(...[...rows.keys()].map((k) => k.length))
console.log(
   `\n${'source | format'.padEnd(keyWidth)}  ${'ok'.padStart(5)} ${'fail'.padStart(5)} ${'parse'.padStart(5)} ${'skip'.padStart(5)}`,
)
console.log('-'.repeat(keyWidth + 25))
for (const [key, row] of [...rows.entries()].sort()) {
   console.log(
      `${key.padEnd(keyWidth)}  ${String(row.ok).padStart(5)} ${String(row.schemaFail).padStart(5)} ${String(row.parseFail).padStart(5)} ${String(row.skipped).padStart(5)}`,
   )
}

const validated = results.filter((r) => r.outcome === 'ok' || r.outcome === 'schema-fail')
const okCount = results.filter((r) => r.outcome === 'ok').length
console.log(
   `\ntotal files: ${results.length} | workflow-format validated: ${validated.length} | ok: ${okCount} | schema-fail: ${validated.length - okCount}`,
)

// ---- top 15 failure causes ----
const topCauses = [...causeCount.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 15)
if (topCauses.length > 0) {
   console.log('\ntop failure causes (first arktype error per file):')
   for (const [cause, info] of topCauses) {
      console.log(`  ${String(info.count).padStart(4)}x  ${cause}`)
      console.log(`         e.g. ${info.example}`)
   }
}
