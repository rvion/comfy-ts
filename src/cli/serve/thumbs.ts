// small previews of LOCAL images for the panel: a choice option's thumb, a media preset, the
// current value of an image var. Not a file server: a path is served only when a served module
// declared it (a thumb, a preset, a default) or it lies under an allowed root (the output root,
// a served module's folder). An http(s) image is never proxied: the page loads it itself.
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'pathe'
import { importSharp } from 'src/utils/lazySharp.ts'

export const isHttpUrl = (s: string): boolean => /^https?:\/\//i.test(s)

/** the url the page loads for a local image's preview */
export function thumbUrl(abs: string, width = 160): string {
   return `/thumb?src=${encodeURIComponent(abs)}&w=${width}`
}

const MAX_WIDTH = 640
const MAX_CACHED = 400

export class ThumbStore {
   private allowed = new Set<string>()
   private roots = new Set<string>()
   private cache = new Map<string, Uint8Array>()

   /** one file a served module declared */
   allow(abs: string): void {
      this.allowed.add(resolve(abs))
   }

   /** every image under this folder */
   allowRoot(dir: string): void {
      this.roots.add(resolve(dir))
   }

   isAllowed(abs: string): boolean {
      const p = resolve(abs)
      if (this.allowed.has(p)) return true
      for (const root of this.roots) if (p.startsWith(`${root}/`)) return true
      return false
   }

   /** a webp at most `width` wide, or why not: 'forbidden' (not declared, not under a root),
    * 'missing' (not on this machine) */
   async render(abs: string, width: number): Promise<Uint8Array | 'forbidden' | 'missing'> {
      if (!this.isAllowed(abs)) return 'forbidden'
      const p = resolve(abs)
      if (!existsSync(p)) return 'missing'
      const w = Math.max(16, Math.min(MAX_WIDTH, Math.round(width)))
      const key = `${p}|${statSync(p).mtimeMs}|${w}`
      const hit = this.cache.get(key)
      if (hit != null) return hit
      const sharp = await importSharp('a thumbnail')
      const bytes = new Uint8Array(
         await sharp(p).rotate().resize({ width: w, height: w, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer(),
      )
      if (this.cache.size >= MAX_CACHED) {
         const oldest = this.cache.keys().next().value
         if (oldest != null) this.cache.delete(oldest)
      }
      this.cache.set(key, bytes)
      return bytes
   }
}
