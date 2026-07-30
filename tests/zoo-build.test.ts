import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'pathe'

// the zoo verification bar, item 2 (agent/examples.md): every zoo example must
// build with `workflow.problems` EMPTY against the cloud schema cache. The
// cache is the machine-local gitignored 9MB object_info dump, so a fresh
// clone/CI skips this suite LOUDLY (describe.skipIf below) — `bun run
// gen:sdk:cloud` or any cloud connect restores it. Builders never run live:
// the uploader is stubbed before any i2i/i2v build. The builds run in ONE
// subprocess: importing example modules in-process would create the global
// `comfyts` singleton and break workflow-builder.test.ts's own `new ComfyTS`
// (bun test shares one process across files).
const repoRoot = join(import.meta.dir, '..')
const cachePath = join(repoRoot, '.comfy-ts', 'hosts', 'comfy-cloud', 'object_info.json')
const zooDir = join(repoRoot, 'examples', 'comfy-cloud')

/** every zoo module + the sd15 reference row that lives outside the folder (example 05) */
function zooFiles(): string[] {
   const files = readdirSync(zooDir)
      .filter((f) => f.endsWith('.cflow.ts'))
      .map((f) => join(zooDir, f))
      .sort()
   files.unshift(join(repoRoot, 'examples', '05-comfy-cloud.cflow.ts'))
   return files
}

type ZooResult = { file: string; error?: string; problems?: unknown[]; nodes?: number }

let sweepMemo: Map<string, ZooResult> | null = null

/** one subprocess builds ALL zoo workflows offline and reports per file; memoized across it.each rows */
function sweep(files: string[]): Map<string, ZooResult> {
   if (sweepMemo != null) return sweepMemo
   // plain JS on purpose: the uploader stub needs no brand cast outside typechecked code
   const script = [
      `const files = ${JSON.stringify(files)}`,
      `const out = []`,
      `for (const f of files) {`,
      `   const mod = await import(f)`,
      `   const wf = mod.default`,
      `   if (wf == null || typeof wf.build !== 'function') { out.push({ file: f, error: 'default export is not a DefinedWorkflow' }); continue }`,
      `   wf.host.uploader.uploadImage = async () => 'zoo-offline-stub.png'`,
      `   const built = await wf.build()`,
      `   out.push({ file: f, problems: built.problems, nodes: Object.keys(built.toApiJson()).length })`,
      `}`,
      `console.log('ZOO_RESULTS ' + JSON.stringify(out))`,
   ].join('\n')
   const res = spawnSync('bun', ['-e', script], { cwd: repoRoot, encoding: 'utf8' })
   const line = res.stdout.split('\n').find((l) => l.startsWith('ZOO_RESULTS '))
   if (res.status !== 0 || line == null) {
      throw new Error(`zoo sweep subprocess failed (status ${res.status}):\n${res.stderr}\n${res.stdout}`)
   }
   const rows: ZooResult[] = JSON.parse(line.slice('ZOO_RESULTS '.length))
   sweepMemo = new Map(rows.map((r) => [r.file, r]))
   return sweepMemo
}

if (!existsSync(cachePath)) {
   console.warn(`[zoo-build] SKIPPED: no cloud schema cache at ${cachePath} — run \`bun run gen:sdk:cloud\` to enable`)
}

describe.skipIf(!existsSync(cachePath))('zoo examples build problems-free against the cloud schema cache', () => {
   const files = zooFiles()
   // a broken listing must never silently pass — the zoo is 40+ files
   expect(files.length).toBeGreaterThan(40)

   it.each(files.map((f) => [f.slice(repoRoot.length + 1), f]))(
      '%s',
      (_label, file) => {
         const row = sweep(files).get(file)
         if (row == null) throw new Error(`no sweep result for ${file}`)
         expect(row.error).toBeUndefined()
         expect(row.problems).toEqual([])
         expect(row.nodes).toBeGreaterThan(0)
      },
      60_000,
   )
})
