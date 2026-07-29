// compat sweep over .comfy-ts/templates/: classify every downloaded JSON, then
// run workflow-format ones through the FULL import chain (ark schema →
// normalize → convert) against ONE cached object_info. The metric split:
// `unknown-node` (host inventory gap, expected when sweeping 779 templates
// against one host) is counted APART from converter defects (ours).
// REPORT ONLY: this script never fixes anything.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'pathe'
import { type } from 'arktype'
import { LiteGraphJSON_ark } from 'src/litegraph/LiteGraphJSON.ts'
import { normalizeWorkflow, WorkflowNormalizeError } from 'src/litegraph/normalizeWorkflow.ts'
import type { CanonicalWorkflow } from 'src/litegraph/CanonicalWorkflow.ts'
import { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import { convertLiteGraphToPrompt, WorkflowConvertError } from 'src/sdk-generator/litegraphToApiRequestPayload.ts'

const ROOT = '.comfy-ts/templates'

// preferred: the local host cache (rich 2026 inventory); fallback: the
// committed 2024 fixture so the sweep runs on a fresh clone too. WHICH one is
// in play changes every unknown-node count, so it is printed loudly below.
const OBJECT_INFO_CANDIDATES = ['.comfy-ts/hosts/windows-1/object_info.json', 'tests/fixtures/object_info.json']

type Outcome = 'ok' | 'schema-fail' | 'normalize-fail' | 'unknown-node' | 'convert-fail' | 'parse-fail' | 'skipped'

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

class CauseTally {
   map = new Map<string, { count: number; example: string }>()
   add(p: { cause: string; example: string }): void {
      const entry = this.map.get(p.cause)
      if (entry == null) this.map.set(p.cause, { count: 1, example: p.example })
      else entry.count++
   }
   top(n: number): [string, { count: number; example: string }][] {
      return [...this.map.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, n)
   }
   print(p: { title: string; n?: number; examples?: boolean }): void {
      if (this.map.size === 0) return
      console.log(`\n${p.title}`)
      for (const [cause, info] of this.top(p.n ?? 15)) {
         console.log(`  ${String(info.count).padStart(4)}x  ${cause}`)
         if (p.examples !== false) console.log(`         e.g. ${info.example}`)
      }
   }
}

if (!existsSync(ROOT)) {
   throw new Error(`[templates] 🔴 ${ROOT}/ not found. Run \`bun run templates:fetch\` first.`)
}

const objectInfoPath = OBJECT_INFO_CANDIDATES.find((p) => existsSync(p))
if (objectInfoPath == null) {
   throw new Error(`[templates] 🔴 no object_info found (tried ${OBJECT_INFO_CANDIDATES.join(', ')})`)
}
const spec = JSON.parse(readFileSync(objectInfoPath, 'utf-8'))
const schema = new ComfySchema({ spec, embeddings: [] })
schema.update({})
console.log(`[templates] converting against ${objectInfoPath} (${Object.keys(spec).length} node types)`)

const results: FileResult[] = []
const schemaCauses = new CauseTally()
const normalizeCauses = new CauseTally()
const convertCauses = new CauseTally()
// first missing node type per file (the converter throws on the FIRST unknown
// node, so a file needing several custom packs counts under one type)
const missingNodeTypes = new CauseTally()

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

   // stage 1: tolerant wire schema
   const out = LiteGraphJSON_ark(data)
   if (out instanceof type.errors) {
      const first = out[0]
      const cause = first == null ? '(no error detail)' : causeKey({ path: first.path, expected: first.expected })
      schemaCauses.add({ cause, example: file })
      results.push({ file, source, format, outcome: 'schema-fail', cause })
      continue
   }

   // stage 2: normalization (canonical strict type, subgraph expansion)
   let canonical: CanonicalWorkflow
   try {
      canonical = normalizeWorkflow(out)
   } catch (err) {
      const cause = err instanceof WorkflowNormalizeError ? `${err.code}: ${err.message}` : `unexpected: ${String(err)}`
      normalizeCauses.add({ cause, example: file })
      results.push({ file, source, format, outcome: 'normalize-fail', cause })
      continue
   }

   // stage 3: conversion against the cached object_info
   try {
      convertLiteGraphToPrompt(schema, canonical)
      results.push({ file, source, format, outcome: 'ok' })
   } catch (err) {
      if (err instanceof WorkflowConvertError && err.code === 'unknown-node') {
         const nodeType = err.node?.type ?? '(unknown type)'
         missingNodeTypes.add({ cause: nodeType, example: file })
         results.push({ file, source, format, outcome: 'unknown-node', cause: nodeType })
         continue
      }
      // node ids collapse so every SaveVideo hitting the same gap shares one bucket
      const cause =
         err instanceof WorkflowConvertError
            ? `${err.code} @ ${err.node?.type ?? '?'}: ${err.message.replace(/node \d+/g, 'node *')}`
            : `unexpected: ${String(err)}`
      convertCauses.add({ cause, example: file })
      results.push({ file, source, format, outcome: 'convert-fail', cause })
   }
}

// ---- summary table: per source × format ----
type Row = Record<Outcome, number>
const emptyRow = (): Row => ({
   ok: 0,
   'schema-fail': 0,
   'normalize-fail': 0,
   'unknown-node': 0,
   'convert-fail': 0,
   'parse-fail': 0,
   skipped: 0,
})
const rows = new Map<string, Row>()
for (const r of results) {
   const key = `${r.source} | ${r.format}`
   const row = rows.get(key) ?? emptyRow()
   row[r.outcome]++
   rows.set(key, row)
}

const COLS: { header: string; outcome: Outcome }[] = [
   { header: 'ok', outcome: 'ok' },
   { header: 'unode', outcome: 'unknown-node' },
   { header: 'cfail', outcome: 'convert-fail' },
   { header: 'nfail', outcome: 'normalize-fail' },
   { header: 'sfail', outcome: 'schema-fail' },
   { header: 'parse', outcome: 'parse-fail' },
   { header: 'skip', outcome: 'skipped' },
]
const keyWidth = Math.max(...[...rows.keys()].map((k) => k.length))
console.log(`\n${'source | format'.padEnd(keyWidth)}  ${COLS.map((c) => c.header.padStart(5)).join(' ')}`)
console.log('-'.repeat(keyWidth + COLS.length * 6 + 1))
for (const [key, row] of [...rows.entries()].sort()) {
   console.log(`${key.padEnd(keyWidth)}  ${COLS.map((c) => String(row[c.outcome]).padStart(5)).join(' ')}`)
}

// ---- headline numbers ----
const count = (outcome: Outcome): number => results.filter((r) => r.outcome === outcome).length
const workflowFiles = results.length - count('skipped') - count('parse-fail')
const okCount = count('ok')
const structural = okCount + count('unknown-node')
const pct = (n: number): string => (workflowFiles === 0 ? '?' : `${((100 * n) / workflowFiles).toFixed(1)}%`)
console.log(`\ntotal files: ${results.length} | workflow-format: ${workflowFiles} | parse-fail: ${count('parse-fail')}`)
console.log(
   `schema-pass:          ${workflowFiles - count('schema-fail')}/${workflowFiles} (${pct(workflowFiles - count('schema-fail'))})`,
)
console.log(`normalize-fail:       ${count('normalize-fail')} | convert-fail (defects, OURS): ${count('convert-fail')}`)
console.log(
   `STRUCTURAL success:   ${structural}/${workflowFiles} (${pct(structural)})  ← ok + unknown-node: the converter did its job`,
)
console.log(`executable on host:   ${okCount}/${workflowFiles} (${pct(okCount)})  ← host-dependent (${objectInfoPath})`)

schemaCauses.print({ title: 'schema failure causes (first arktype error per file):' })
normalizeCauses.print({ title: 'normalize failure causes:' })
convertCauses.print({ title: 'convert DEFECT causes (ours, grind these):' })
missingNodeTypes.print({
   title: 'missing node types (first per file) — install X to unlock N templates:',
   n: 20,
   examples: false,
})
