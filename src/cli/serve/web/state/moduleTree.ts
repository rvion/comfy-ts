// the sidebar is a TREE, not a list: modules keep the folder they came from.
// PURE and DOM-free (browser side, so no node:path), tests/serve-web-tree.test.ts.
// the module KEY stays the basename (it is the api identity); this only decides
// what the sidebar shows above it.

export type TreeItem = { module: string; file: string }

export type ModuleGroup<T extends TreeItem> = { folder: string; modules: T[] }

function segmentsOf(path: string): string[] {
   return path.split(/[/\\]/).filter((s) => s !== '')
}

function dirSegments(file: string): string[] {
   return segmentsOf(file).slice(0, -1)
}

/** longest shared leading path of every module, as segments */
function commonPrefix(dirs: string[][]): string[] {
   const first = dirs[0]
   if (first == null) return []
   const out: string[] = []
   for (let i = 0; i < first.length; i++) {
      const seg = first[i]
      if (seg == null || !dirs.every((d) => d[i] === seg)) break
      out.push(seg)
   }
   return out
}

/**
 * group by folder, labelled from ONE level above the shared root, so serving a single
 * folder still says `rvion` instead of showing a flat list with the prefix eaten. Groups
 * and modules stay in a stable alphabetical order, drafts keep the server's order.
 */
export function groupModulesByFolder<T extends TreeItem>(modules: readonly T[]): ModuleGroup<T>[] {
   if (modules.length === 0) return []
   const dirs = modules.map((m) => dirSegments(m.file))
   // one level up from the shared root: that last segment is the label worth seeing
   const shared = commonPrefix(dirs)
   const cut = Math.max(0, shared.length - 1)
   const groups = new Map<string, T[]>()
   for (const [i, mod] of modules.entries()) {
      const folder = (dirs[i] ?? []).slice(cut).join('/')
      const list = groups.get(folder)
      if (list == null) groups.set(folder, [mod])
      else list.push(mod)
   }
   return [...groups.entries()]
      .map(([folder, list]) => ({ folder, modules: [...list].sort((a, b) => a.module.localeCompare(b.module)) }))
      .sort((a, b) => a.folder.localeCompare(b.folder))
}
