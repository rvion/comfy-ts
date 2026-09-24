import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'pathe'
// the zoo verification bar, item 2 (agent/examples.md): every zoo example must
// build with `workflow.problems` EMPTY against the cloud schema cache. The
// cache is the machine-local gitignored 9MB object_info dump, so a fresh
// clone/CI skips this suite LOUDLY (describe.skipIf below) — `bun run
// gen:sdk:cloud` or any cloud connect restores it. Builders never run live:
// the uploader is stubbed before any i2i/i2v build. The builds run in this
// process under their OWN global registry: the examples register through
// ComfyTS.create(), and the one another file registered is handed back after.
const repoRoot = join(import.meta.dir, '..')
const cachePath = join(repoRoot, '.comfy-ts', 'hosts', 'comfy-cloud', 'object_info.json')
const zooDir = join(repoRoot, 'examples', 'comfy-cloud')

/** every zoo module + the sd15 reference row that lives outside the folder (example 05) */
function zooFiles(): string[] {
   const files = readdirSync(zooDir)
      .filter((f) => f.endsWith('.cflow.ts'))
      .map((f) => join(zooDir, f))
      .sort()
   files.unshift(join(repoRoot, 'examples', 'rvion', '05-comfy-cloud.cflow.ts'))
   return files
}

type ZooResult = { file: string; error?: string; problems?: unknown[]; nodes?: number }
type ZooWorkflow = {
   host: { uploader: { uploadImage: () => Promise<string> } }
   build: () => Promise<{ problems: unknown[]; toApiJson: () => Record<string, unknown> }>
}
function isZooWorkflow(x: unknown): x is ZooWorkflow {
   return typeof x === 'object' && x != null && 'host' in x && 'build' in x && typeof x.build === 'function'
}

let sweepMemo: Map<string, ZooResult> | null = null
/** builds ALL zoo workflows offline and reports per file; memoized across it.each rows */
async function sweep(files: string[]): Promise<Map<string, ZooResult>> {
   if (sweepMemo != null) return sweepMemo
   const globalHack = globalThis as { comfyts?: unknown }
   const prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   const out: ZooResult[] = []
   try {
      for (const file of files) {
         const mod: { default?: unknown } = await import(file)
         const wf = mod.default
         if (!isZooWorkflow(wf)) {
            out.push({ file, error: 'default export is not a DefinedWorkflow' })
            continue
         }
         wf.host.uploader.uploadImage = async () => 'zoo-offline-stub.png'
         const built = await wf.build()
         out.push({ file, problems: built.problems, nodes: Object.keys(built.toApiJson()).length })
      }
   } finally {
      if (prior != null) globalHack.comfyts = prior
      else Reflect.deleteProperty(globalThis, 'comfyts')
   }
   sweepMemo = new Map(out.map((r) => [r.file, r]))
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
      async (_label, file) => {
         const row = (await sweep(files)).get(file)
         if (row == null) throw new Error(`no sweep result for ${file}`)
         expect(row.error).toBeUndefined()
         expect(row.problems).toEqual([])
         expect(row.nodes).toBeGreaterThan(0)
      },
      60_000,
   )
})
