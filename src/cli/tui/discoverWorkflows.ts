import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'pathe'

/** recursive scan for the workflow-module naming convention */
export function scanCflowFiles(dir: string): string[] {
   const hits = readdirSync(dir, { recursive: true })
      .map((f) => join(dir, String(f)))
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
         const pkg: { name?: string } = JSON.parse(readFileSync(pkgPath, 'utf8'))
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
