// the `*.cflow.ts` modules under the cwd for `comfy-ts run`, walked with bounds: node_modules
// and dot dirs are never entered (a recursive readdir reads all of them before any filter,
// which stalls a run started in a big repo or a temp dir), and the walk stops MAX_DEPTH deep
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'pathe'

export const MAX_DEPTH = 5

export function findModules(dir: string, depth = 0): string[] {
   let entries: import('node:fs').Dirent[]
   try {
      entries = readdirSync(dir, { withFileTypes: true })
   } catch {
      return []
   }
   const out: string[] = []
   for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isFile() && /\.cflow\.tsx?$/.test(e.name)) out.push(join(dir, e.name))
      else if (e.isDirectory() && depth < MAX_DEPTH && e.name !== 'node_modules' && !e.name.startsWith('.'))
         out.push(...findModules(join(dir, e.name), depth + 1))
   }
   return out
}

/** the workspace a module belongs to: the nearest folder above it holding `.comfy-ts/` (its
 * schema cache and its tuned drafts), or null. A run roots comfy-ts there, so it never writes a
 * `.comfy-ts/` into whatever folder it was started from */
export function workspaceOf(file: string): string | null {
   let dir = dirname(file)
   while (true) {
      if (existsSync(join(dir, '.comfy-ts'))) return dir
      const up = dirname(dir)
      if (up === dir) return null
      dir = up
   }
}
