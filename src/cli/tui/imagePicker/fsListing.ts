import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'pathe'

export type DirListing = { dirs: string[]; images: string[] }

/** `name.PNG` matches extensions `['png']` — extensions are lowercase, no dots */
export function hasImageExtension(name: string, extensions: readonly string[]): boolean {
   const dot = name.lastIndexOf('.')
   if (dot <= 0) return false
   return extensions.includes(name.slice(dot + 1).toLowerCase())
}

/**
 * ONE folder for the picker: dirs first then images, both alphabetical,
 * images filtered by extension. Dot FILES are junk (.DS_Store) and skipped;
 * dot DIRS are listed — .comfy-ts/outputs must be browsable. Symlinks are
 * followed (a dangling one is skipped). Pure over fs — an unreadable dir
 * THROWS, the caller surfaces it (never a silent empty listing).
 */
export function listImageDir(dir: string, extensions: readonly string[]): DirListing {
   const dirs: string[] = []
   const images: string[] = []
   for (const entry of readdirSync(dir, { withFileTypes: true })) {
      let isDir = entry.isDirectory()
      let isFile = entry.isFile()
      if (entry.isSymbolicLink()) {
         try {
            const target = statSync(join(dir, entry.name))
            isDir = target.isDirectory()
            isFile = target.isFile()
         } catch {
            continue // dangling symlink: neither dir nor image
         }
      }
      // after symlink resolution, so a dot-named link to a real dir stays listed
      if (entry.name.startsWith('.') && !isDir) continue
      if (isDir) dirs.push(entry.name)
      else if (isFile && hasImageExtension(entry.name, extensions)) images.push(entry.name)
   }
   dirs.sort((a, b) => a.localeCompare(b))
   images.sort((a, b) => a.localeCompare(b))
   return { dirs, images }
}

/** parent for `←` navigation — the fs root is its own parent (never ascends past it) */
export function parentDir(dir: string): string {
   return dirname(dir)
}
