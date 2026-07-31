import { describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'pathe'

/**
 * A lora-manager sweep describes ONE machine's model collection: absolute disk
 * paths, content ratings, remote ids, the full inventory. That is private to
 * whoever runs the host, so it must never become a tracked file in this repo.
 *
 * Test fixtures here are synthetic. A real sweep is read only from gitignored
 * locations (`.comfy-ts/hosts/<id>/loras.json`), which is what
 * lora-corpus.private.test.ts does when one happens to exist.
 *
 * The needles are assembled from pieces so this guard never trips over itself.
 */
const NEEDLES: { label: string; needle: string }[] = [
   { label: 'a content-rating field', needle: `preview_${'nsfw'}_level` },
   { label: 'a remote-provenance flag', needle: `from_${'civitai'}` },
   { label: 'a metadata-refresh flag', needle: `skip_${'metadata'}_refresh` },
   { label: 'a windows model path', needle: `models${'\\\\'}loras` },
]
/** an absolute drive path in a json path field is someone's real disk */
const DRIVE_PATH = new RegExp(`"file${'_path'}"\\s*:\\s*"[A-Za-z]:`)

const SELF = 'tests/no-personal-lora-data.test.ts'
const SYNTHETIC = 'tests/fixtures/lm-loras-list.synthetic.json'
/** a hand-written fixture documents a handful of CASES; past this it is a collection */
const MAX_INVENTORY_ENTRIES = 20

function trackedFiles(): string[] {
   return execFileSync('git', ['ls-files'], { encoding: 'utf8' })
      .split('\n')
      .filter((f) => f !== '')
}

/**
 * npm packs by package.json's `files` whitelist and never consults git, so a
 * file that is merely UNTRACKED still ships. Scanning only `git ls-files` would
 * leave that hole open: walk every packed tree from disk too. `dist/` is the
 * sharpest case — gitignored AND published, so neither half of the union saw it.
 */
function packedSourceFiles(): string[] {
   const out: string[] = []
   const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
         const full = join(dir, entry.name)
         if (entry.isDirectory()) {
            if (entry.name !== 'node_modules') walk(full)
         } else out.push(full)
      }
   }
   for (const root of ['src', 'examples', 'dist']) if (existsSync(root)) walk(root)
   return out
}

describe('no captured lora inventory is tracked by git', () => {
   it('runs from the repo root, or it scans almost nothing and passes green', () => {
      // every path here is cwd-relative: from a subdirectory `git ls-files` returns
      // a subtree and `src/` does not exist, so the guard would silently no-op
      expect(existsSync('package.json') && existsSync('src') && existsSync('tests')).toBe(true)
   })

   it('nothing git tracks, and nothing npm would pack, carries lora-manager dump markers', () => {
      const offenders: string[] = []
      for (const file of [...new Set([...trackedFiles(), ...packedSourceFiles()])]) {
         if (file === SELF) continue
         let stat: { size: number }
         try {
            stat = statSync(file)
         } catch {
            continue // deleted but still indexed
         }
         // NO content exemptions: a big file is the worst case, not the exempt one.
         // The upstream manager catalogs (~3MB each) are scanned like everything
         // else and pass. The cap only skips what is too large to read as text.
         if (stat.size > 40_000_000) continue
         let text: string
         try {
            text = readFileSync(file, 'utf8')
         } catch {
            continue // binary
         }
         for (const n of NEEDLES) if (text.includes(n.needle)) offenders.push(`${file} — ${n.label}`)
         if (DRIVE_PATH.test(text)) offenders.push(`${file} — absolute drive path in a file_path field`)
      }
      expect(offenders).toEqual([])
   })

   it('no lora mirror is tracked, wherever it sits', () => {
      const mirrors = trackedFiles().filter((f) => /(^|\/)loras\.json$/.test(f) || f.endsWith('.captured.json'))
      expect(mirrors).toEqual([])
   })

   it('no tracked or packed file carries a BULK model inventory, whatever it is named', () => {
      // the needles above catch a copy-pasted dump. This catches the likelier
      // next mistake: a hand-trimmed one — telltale fields stripped, paths made
      // relative, saved as any name — that is still a real collection.
      const NAME_KEY = /"(model_name|file_name)"\s*:/g
      const offenders: string[] = []
      for (const file of [...new Set([...trackedFiles(), ...packedSourceFiles()])]) {
         if (file === SELF || file === SYNTHETIC) continue
         if (!/\.(json|jsonl|ts|tsx|md|txt|csv)$/.test(file)) continue
         let text: string
         try {
            text = readFileSync(file, 'utf8')
         } catch {
            continue
         }
         const count = text.match(NAME_KEY)?.length ?? 0
         if (count > MAX_INVENTORY_ENTRIES) offenders.push(`${file} — ${count} model entries`)
      }
      expect(offenders).toEqual([])
   })

   it('the only lora fixture is the SYNTHETIC one, and it is small', () => {
      // tracked OR merely sitting in the working tree: a second lm-loras fixture is a capture
      expect(trackedFiles().filter((f) => f.startsWith('tests/fixtures/lm-loras') && f !== SYNTHETIC)).toEqual([])
      expect(readdirSync('tests/fixtures').filter((f) => f.startsWith('lm-loras'))).toEqual([basename(SYNTHETIC)])
      // a real sweep is 150+ entries; a fixture that big is a capture, not a hand-written sample
      const page: unknown = JSON.parse(readFileSync(SYNTHETIC, 'utf8'))
      expect((page as { items: unknown[] }).items.length).toBeLessThan(20)
   })
})
