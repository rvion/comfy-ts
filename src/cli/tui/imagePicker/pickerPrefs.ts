import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { makeAutoObservable } from 'mobx'
import { dirname, join } from 'pathe'
import { logError } from 'src/utils/log.ts'

export const RECENTS_CAP = 20

/**
 * image-picker favorites + recents + lastFolder — loraKeywords pattern:
 * observable, loaded once, written through on every mutation. Human-editable
 * json at `.comfy-ts/image-picker.json` (hand-tuned data, NOT under cache/ —
 * survives a cache wipe):
 *    { "favorites": ["/abs/dir"], "recents": ["/abs/img.png"], "lastFolder": "/abs/dir" }
 * A corrupt file logs loud and starts fresh, never blocks the TUI. The class
 * takes its file path explicitly so tests round-trip it headless; the TUI
 * uses the ONE lazy module singleton below.
 */
export class PickerPrefs {
   /** favorite FOLDERS, absolute — recents cover files */
   favorites: string[] = []
   /** picked images, absolute, newest first, deduped, capped */
   recents: string[] = []
   lastFolder: string | null = null

   constructor(public readonly path: string) {
      this.load()
      makeAutoObservable(this)
   }

   private load(): void {
      if (!existsSync(this.path)) return
      try {
         const raw: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
         if (raw == null || typeof raw !== 'object') throw new Error('not a json object')
         const o = raw as Record<string, unknown>
         if (Array.isArray(o.favorites)) this.favorites = o.favorites.filter((f): f is string => typeof f === 'string')
         if (Array.isArray(o.recents))
            this.recents = o.recents.filter((r): r is string => typeof r === 'string').slice(0, RECENTS_CAP)
         if (typeof o.lastFolder === 'string') this.lastFolder = o.lastFolder
      } catch (e) {
         logError(`[imagePicker] unreadable ${this.path} — starting fresh: ${String(e)}`)
      }
   }

   private write(): void {
      try {
         mkdirSync(dirname(this.path), { recursive: true })
         const json = { favorites: this.favorites, recents: this.recents, lastFolder: this.lastFolder }
         writeFileSync(this.path, `${JSON.stringify(json, null, 2)}\n`)
      } catch (e) {
         logError(`[imagePicker] write failed ${this.path}: ${String(e)}`)
      }
   }

   isFavorite(dir: string): boolean {
      return this.favorites.includes(dir)
   }

   toggleFavorite(dir: string): void {
      this.favorites = this.favorites.includes(dir) ? this.favorites.filter((f) => f !== dir) : [...this.favorites, dir]
      this.write()
   }

   /** a pick records the image (newest first, deduped, capped) AND remembers its folder */
   recordPick(imagePath: string): void {
      this.recents = [imagePath, ...this.recents.filter((r) => r !== imagePath)].slice(0, RECENTS_CAP)
      this.lastFolder = dirname(imagePath)
      this.write()
   }
}

let _prefs: PickerPrefs | null = null

/** the TUI's store, bound lazily to `.comfy-ts/image-picker.json` (gitignored) */
export function pickerPrefs(): PickerPrefs {
   if (_prefs == null) _prefs = new PickerPrefs(join(comfyts.baseFolder, 'image-picker.json'))
   return _prefs
}
