import { readdirSync } from 'node:fs'
import { join } from 'pathe'

/**
 * recursive scan for the workflow-module naming convention. Entries BELOW a
 * node_modules segment are skipped: packaged examples arrive via
 * bundledExamplesDir (src/exampleAssets.ts — symlinked layouts like pnpm would
 * otherwise list them twice, un-deduped, as the user's own files), and
 * third-party packages shipping *.cflow.ts are not this project's workflows. A
 * scan root that is ITSELF inside node_modules still works (the filter is
 * relative to the root).
 */
export function scanCflowFiles(dir: string): string[] {
   const hits = readdirSync(dir, { recursive: true })
      .map((f) => String(f))
      .filter((f) => !f.split('/').includes('node_modules'))
      .map((f) => join(dir, f))
      .filter((f) => f.endsWith('.cflow.ts') || f.endsWith('.cflow.tsx'))
   return hits.sort()
}

export type WorkflowDiscovery = {
   /** every module the tree lists, user files first, bundled examples last */
   files: string[]
   /** the subset that came from the PACKAGED examples (grouped apart in the tree) */
   bundled: Set<string>
}

/**
 * PURE merge of the scan with the packaged examples (headless-tested). An
 * explicit target keeps its scope only. Bundled files ALWAYS group under the
 * bundled section, also when the scan already found them (repo dev: ./examples
 * is under cwd) — dedupe relies on the caller passing realpath-normalized
 * strings on both sides.
 */
export function mergeWorkflowSources(p: {
   explicitTarget: boolean
   scanned: string[]
   bundledFiles: string[]
}): WorkflowDiscovery {
   if (p.explicitTarget) return { files: p.scanned, bundled: new Set() }
   const bundled = new Set(p.bundledFiles)
   const userFiles = p.scanned.filter((f) => !bundled.has(f))
   return { files: [...userFiles, ...p.bundledFiles], bundled }
}
