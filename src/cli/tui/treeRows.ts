import { basename, dirname } from 'pathe'

/**
 * PURE tree-shaping layer under TreeSt (headless-tested): turns the flat
 * discovered file list into hierarchy rows (directory nodes + files), applies
 * the `/` substring filter, and owns the per-family color assignment.
 */

export type FileTreeRow =
   | { kind: 'dir'; path: string; label: string; depth: number; expanded: boolean }
   | { kind: 'file'; file: string; name: string; depth: number }

/** module display name — also the drafts folder key (DraftsSt delegates here) */
export function moduleName(file: string): string {
   return basename(file).replace(/\.cflow\.tsx?$/, '')
}

/** the color word: everything before the first `-` (`flux1-i2i` → `flux1`) */
export function familyOf(name: string): string {
   const dash = name.indexOf('-')
   return dash === -1 ? name : name.slice(0, dash)
}

/** hue-spread so CONSECUTIVE families land on clearly distinct colors */
export const FAMILY_PALETTE: string[] = [
   '#61afef', // blue
   '#e5c07b', // amber
   '#c678dd', // magenta
   '#98c379', // green
   '#e06c75', // rose
   '#56b6c2', // teal
   '#d19a66', // orange
   '#a5b4fc', // lavender
   '#a5e075', // lime
   '#f28fad', // pink
]

/** family → color, palette cycled in first-appearance order over the FULL
 * (unfiltered) file list — stable while filtering/folding */
export function assignFamilyColors(files: string[]): Map<string, string> {
   const colors = new Map<string, string>()
   for (const file of files) {
      const family = familyOf(moduleName(file))
      if (colors.has(family)) continue
      colors.set(family, FAMILY_PALETTE[colors.size % FAMILY_PALETTE.length] ?? '#61afef')
   }
   return colors
}

type DirNode = {
   /** deepest real directory path of this node (unique row key) */
   path: string
   label: string
   files: string[]
   dirs: Map<string, DirNode>
}

function commonDir(files: string[]): string {
   const first = files[0]
   if (first == null) return ''
   let prefix = dirname(first).split('/')
   for (const f of files.slice(1)) {
      const segs = dirname(f).split('/')
      let i = 0
      while (i < prefix.length && i < segs.length && prefix[i] === segs[i]) i++
      prefix = prefix.slice(0, i)
   }
   return prefix.join('/')
}

function insert(root: DirNode, rootDir: string, file: string): void {
   const rel = dirname(file).slice(rootDir.length).replace(/^\//, '')
   const segs = rel === '' ? [] : rel.split('/')
   let node = root
   for (const seg of segs) {
      let child = node.dirs.get(seg)
      if (child == null) {
         child = { path: `${node.path}/${seg}`, label: seg, files: [], dirs: new Map() }
         node.dirs.set(seg, child)
      }
      node = child
   }
   node.files.push(file)
}

/** a dir holding NOTHING but one subdir shows as one `a/b` row */
function mergeChains(node: DirNode): void {
   // snapshot: the loop rewrites node.dirs entries while iterating
   const entries = [...node.dirs]
   for (const [key, child] of entries) {
      mergeChains(child)
      if (child.files.length === 0 && child.dirs.size === 1) {
         const only = [...child.dirs.values()][0]!
         const label = `${child.label}/${only.label}`
         node.dirs.delete(key)
         // re-key by the MERGED label: keying by only.label could clobber a
         // real sibling dir of the same name (segments never contain '/')
         node.dirs.set(label, { ...only, label })
      }
   }
}

function matches(file: string, rootDir: string, filter: string): boolean {
   if (filter === '') return true
   // dir path + module name, NOT the raw filename: '.cflow.ts' matching
   // everything would make the filter useless for 'ts', 'flow', '.'
   const haystack = `${dirname(file).slice(rootDir.length)}/${moduleName(file)}`.toLowerCase()
   return haystack.includes(filter.toLowerCase())
}

function emit(p: {
   node: DirNode
   depth: number
   rootDir: string
   collapsedDirs: Set<string>
   filter: string
   out: FileTreeRow[]
}): void {
   for (const file of p.node.files) {
      if (!matches(file, p.rootDir, p.filter)) continue
      p.out.push({ kind: 'file', file, name: moduleName(file), depth: p.depth })
   }
   for (const dir of [...p.node.dirs.values()].sort((a, b) => a.label.localeCompare(b.label))) {
      const kept: FileTreeRow[] = []
      // a collapsed dir still ignores its fold while a filter narrows the tree
      const expanded = p.filter !== '' || !p.collapsedDirs.has(dir.path)
      emit({ ...p, node: dir, depth: p.depth + 1, out: kept })
      if (p.filter !== '' && kept.length === 0) continue // prune filtered-empty dirs
      p.out.push({ kind: 'dir', path: dir.path, label: dir.label, depth: p.depth, expanded })
      if (expanded) p.out.push(...kept)
   }
}

/**
 * hierarchy rows over the discovered files: user files under their common
 * root, packaged examples LAST under one foldable 'comfy-ts examples' node.
 */
export function buildFileRows(p: {
   userFiles: string[]
   bundledFiles: string[]
   collapsedDirs: Set<string>
   filter: string
}): FileTreeRow[] {
   const out: FileTreeRow[] = []
   if (p.userFiles.length > 0) {
      const rootDir = commonDir(p.userFiles)
      const root: DirNode = { path: rootDir, label: '', files: [], dirs: new Map() }
      for (const f of p.userFiles) insert(root, rootDir, f)
      mergeChains(root)
      emit({ node: root, depth: 0, rootDir, collapsedDirs: p.collapsedDirs, filter: p.filter, out })
   }
   if (p.bundledFiles.length > 0) {
      const rootDir = commonDir(p.bundledFiles)
      const root: DirNode = { path: rootDir, label: 'comfy-ts examples', files: [], dirs: new Map() }
      for (const f of p.bundledFiles) insert(root, rootDir, f)
      mergeChains(root)
      const kept: FileTreeRow[] = []
      const expanded = p.filter !== '' || !p.collapsedDirs.has(rootDir)
      emit({ node: root, depth: 1, rootDir, collapsedDirs: p.collapsedDirs, filter: p.filter, out: kept })
      if (p.filter !== '' && kept.length === 0) return out
      out.push({ kind: 'dir', path: rootDir, label: root.label, depth: 0, expanded })
      if (expanded) out.push(...kept)
   }
   return out
}
