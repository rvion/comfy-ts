import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'pathe'

/**
 * Every file this repo publishes: what git tracks (GitHub) and what npm packs. npm packs by
 * package.json's `files` whitelist and never consults git, so an UNTRACKED file in a packed folder
 * still ships, and `dist/` is gitignored AND published. A privacy guard scans the union, read once
 * per process and shared by every guard in it.
 */
export const REPO_ROOT = join(import.meta.dir, '..')

/** a file this large is not text a person wrote; everything below is scanned, big catalogs included */
const MAX_TEXT_BYTES = 40_000_000

export type ShippedText = { file: string; text: string }

const trackedMemo = new Map<string, string[]>()
export function trackedFiles(root: string = REPO_ROOT): string[] {
   let files = trackedMemo.get(root)
   if (files == null) {
      files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
         .split('\n')
         .filter((f) => f !== '')
      trackedMemo.set(root, files)
   }
   return files
}

/** the files npm packs from `root`, read from its package.json `files`, root-relative */
export function packedFiles(root: string = REPO_ROOT): string[] {
   const pkg: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
   const entries = (pkg as { files?: unknown }).files
   if (!Array.isArray(entries)) throw new Error(`${root}/package.json has no "files" list: npm would pack everything`)
   const out: string[] = []
   const walk = (rel: string): void => {
      for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
         const child = `${rel}/${entry.name}`
         if (entry.isDirectory()) {
            if (entry.name !== 'node_modules') walk(child)
         } else out.push(child)
      }
   }
   for (const entry of entries) {
      if (typeof entry !== 'string' || /[*?{[]/.test(entry))
         throw new Error(
            `package.json "files" entry ${JSON.stringify(entry)}: a glob, which packedFiles does not expand`,
         )
      const rel = entry.replace(/\/+$/, '')
      if (!existsSync(join(root, rel))) continue
      if (statSync(join(root, rel)).isDirectory()) walk(rel)
      else out.push(rel)
   }
   return out
}

/** reads each file as text; binaries too, since a PNG carries its prompt in a plain text chunk */
export function readTexts(root: string, files: Iterable<string>): ShippedText[] {
   const out: ShippedText[] = []
   for (const file of new Set(files)) {
      const abs = join(root, file)
      let stat: { size: number; isFile(): boolean }
      try {
         stat = statSync(abs)
      } catch {
         continue // deleted but still indexed
      }
      if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) continue
      out.push({ file, text: readFileSync(abs, 'utf8') })
   }
   return out
}

const shippedMemo = new Map<string, ShippedText[]>()
/** every tracked or packed file under `root`, as text */
export function shippedTexts(root: string = REPO_ROOT): ShippedText[] {
   let texts = shippedMemo.get(root)
   if (texts == null) {
      texts = readTexts(root, [...trackedFiles(root), ...packedFiles(root)])
      shippedMemo.set(root, texts)
   }
   return texts
}
