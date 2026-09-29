// `comfy-ts run <name>`: which module a name means, over the discovered files in their order
// (cwd first, then the bundled examples). A name may carry its folder (`rvion/anima`,
// `comfy-cloud/anima`), which narrows to modules in a folder of that name. Tiers, first hit
// wins: the exact module key, the key without its number (`anima-t2i` → `10-anima-t2i`), a
// prefix of that, a substring. Two modules on the first tier that hits is ambiguous, and the
// error names them with their folder
import { basename, dirname } from 'pathe'
import { moduleName } from 'src/cli/tui/treeRows.ts'

export type Picked = { file: string; key: string } | { error: string }

const bare = (key: string): string => key.replace(/^\d+-/, '')
const qualified = (file: string): string => `${basename(dirname(file))}/${moduleName(file)}`

export function pickModule(files: readonly string[], name: string): Picked {
   const cut = name.lastIndexOf('/')
   const folder = cut < 0 ? null : name.slice(0, cut).toLowerCase()
   const n = name.slice(cut + 1).toLowerCase()
   // one file per qualified name, the first one found: a cwd module shadows a bundled one
   const byName = new Map<string, string>()
   for (const f of files) {
      if (folder != null && !qualified(f).toLowerCase().startsWith(`${folder}/`)) continue
      if (!byName.has(qualified(f))) byName.set(qualified(f), f)
   }
   const all = [...byName.values()]
   const tiers: ((k: string) => boolean)[] = [
      (k) => k === n,
      (k) => bare(k) === n,
      (k) => bare(k).startsWith(n),
      (k) => k.includes(n),
   ]
   for (const hit of tiers) {
      const found = all.filter((f) => hit(moduleName(f).toLowerCase()))
      if (found.length === 1) return { file: found[0]!, key: moduleName(found[0]!) }
      if (found.length > 1)
         return {
            error: `'${name}' matches ${found.length} modules: ${found.map(qualified).join(', ')}. Name one, folder included`,
         }
   }
   return { error: `no module matches '${name}'. Modules: ${all.map(qualified).join(', ')}` }
}
