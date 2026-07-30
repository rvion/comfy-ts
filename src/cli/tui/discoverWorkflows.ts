import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'pathe'

/**
 * recursive scan for the workflow-module naming convention. Entries BELOW a
 * node_modules segment are skipped: packaged examples arrive via
 * bundledExamplesDir (symlinked layouts like pnpm would otherwise list them
 * twice, un-deduped, as the user's own files), and third-party packages
 * shipping *.cflow.ts are not this project's workflows. A scan root that is
 * ITSELF inside node_modules still works (the filter is relative to the root).
 */
export function scanCflowFiles(dir: string): string[] {
   const hits = readdirSync(dir, { recursive: true })
      .map((f) => String(f))
      .filter((f) => !f.split('/').includes('node_modules'))
      .map((f) => join(dir, f))
      .filter((f) => f.endsWith('.cflow.ts') || f.endsWith('.cflow.tsx'))
   return hits.sort()
}

/**
 * the examples/ folder shipped in the npm tarball, resolved from THIS module's
 * own location (NEVER cwd): walking up to the nearest NAMED package.json finds
 * <pkg>/examples both from a consumer's node_modules/comfy-ts/dist/cli.js and
 * from this repo's src/cli/tui/. Returns null when the examples are absent
 * (a consumer may prune the folder) or when the nearest named package is not
 * comfy-ts (the lib was inlined into someone else's bundle — its examples are
 * not on disk); no package.json all the way up is a broken install and throws.
 */
export function bundledExamplesDir(moduleUrl: string = import.meta.url): string | null {
   let dir = dirname(fileURLToPath(moduleUrl))
   let prev = ''
   while (dir !== prev) {
      const pkgPath = join(dir, 'package.json')
      if (existsSync(pkgPath)) {
         let pkg: { name?: string } = {}
         try {
            pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
         } catch {
            // a malformed package.json on the walk (someone's broken fixture
            // dir) must not take the whole TUI down; treat as unnamed
         }
         if (pkg.name === 'comfy-ts') {
            const examples = join(dir, 'examples')
            return existsSync(examples) ? examples : null
         }
         if (pkg.name != null) return null
      }
      prev = dir
      dir = dirname(dir)
   }
   throw new Error(`[comfy-ts tui] no package.json found walking up from ${fileURLToPath(moduleUrl)}`)
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
