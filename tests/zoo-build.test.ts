import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'pathe'
import { DefinedWorkflow } from 'src/vars/DefinedWorkflow.ts'
import type { ComfyImageName } from 'src/sdk-generator/comfyui-types.ts'

// the zoo verification bar, item 2 (agent/examples.md): every zoo example must
// build with `workflow.problems` EMPTY against the cloud schema cache. The
// cache is the machine-local gitignored 9MB object_info dump, so a fresh
// clone/CI skips this suite LOUDLY (describe.skipIf below) — `bun run
// gen:sdk:cloud` or any cloud connect restores it. Builders never run live:
// the uploader is stubbed before any i2i/i2v build.
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
         const mod: Record<string, unknown> = await import(file)
         const wf = mod.default
         if (!(wf instanceof DefinedWorkflow)) throw new Error(`${file} default export is not a DefinedWorkflow`)
         // offline stub: hash-deduped upload is the one network touch a build can make
         // (brand cast: ComfyImageName is a branded string, same spelling as ComfyUploader itself)
         wf.host.uploader.uploadImage = async () => 'zoo-offline-stub.png' as ComfyImageName
         const built = await wf.build()
         expect(built.problems).toEqual([])
         expect(Object.keys(built.toApiJson()).length).toBeGreaterThan(0)
      },
      30_000,
   )
})
