import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { makeAutoObservable, reaction } from 'mobx'
import { basename, dirname, resolve } from 'pathe'
import { listImageDir, parentDir } from 'src/cli/tui/imagePicker/fsListing.ts'
import { pickerPrefs } from 'src/cli/tui/imagePicker/pickerPrefs.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import { fuzzyMatch } from 'src/utils/fuzzyMatch.ts'
import { imageBufferToAnsi } from 'src/utils/ansiImage.ts'
import { protocolReadyBytes } from 'src/utils/protocolImage.ts'
import type { ImageVar } from 'src/vars/ComfyVars.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

export type PickerPane = 'browse' | 'favorites' | 'recents'
export const PICKER_PANES: readonly PickerPane[] = ['browse', 'favorites', 'recents']

export type PickerRow =
   | { kind: 'dir'; name: string; path: string }
   | { kind: 'image'; name: string; path: string; missing: boolean }

/** `~`-contract $HOME for display (ImageVar.display's convention) */
export function contractHome(path: string): string {
   const home = homedir()
   return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/**
 * image-picker overlay (mode 'overlay-image'): browse the disk for an image
 * var, three panes (browse / favorites / recents), filter-as-you-type, the
 * highlighted image previews into the panel via PreviewSt's overlay slot.
 */
export class ImagePickerSt {
   constructor(private st: TuiSt) {
      makeAutoObservable<ImagePickerSt, 'st'>(this, { st: false })
      // the highlighted image's preview follows the cursor (debounced so
      // arrowing fast never thrashes sharp; renders into the preview panel)
      this.st.disposers.push(
         reaction(
            () => (this.st.mode === 'overlay-image' ? this.highlightedImage : null),
            () => void this.refreshPreview(),
            { delay: 120 },
         ),
      )
   }

   pane: PickerPane = 'browse'
   /** current browse folder, absolute */
   folder: string = process.cwd()
   ix: number = 0
   filter: string = ''

   /** kind-narrowing cast sanctioned (agent/coding.md), `kind` is the tag */
   get selectedVar(): ImageVar | null {
      const sel = this.st.selected?.[1]
      return sel?.kind === 'image' ? (sel as ImageVar) : null
   }

   get folderDisplay(): string {
      return contractHome(this.folder)
   }

   /** begin() open order: dirname(value) → persisted lastFolder → opts.folder → cwd */
   private initialFolder(iv: ImageVar): string {
      const candidates: (string | null)[] = [
         iv.isSet() ? dirname(iv.absPath()) : null,
         pickerPrefs().lastFolder,
         iv.opts.folder != null ? resolve(iv.opts.folder) : null,
      ]
      for (const c of candidates) {
         try {
            if (c != null && statSync(c).isDirectory()) return c
         } catch {
            // vanished candidate: fall through to the next one
         }
      }
      return process.cwd()
   }

   begin(): void {
      const iv = this.selectedVar
      if (iv == null) return
      this.st.mode = 'overlay-image'
      this.pane = 'browse'
      this.filter = ''
      this.ix = 0
      this.folder = this.initialFolder(iv)
      // fresh overlay starts on the placeholder, never a stale slot image
      this.st.preview.clearOverlayImage()
   }

   cancel(): void {
      this.st.mode = 'nav'
   }

   // ---- listing ----
   /** every row of the active pane BEFORE the filter, plus the browse-pane
    * read error (unreadable folder: shown IN the overlay, browsing elsewhere
    * stays possible). Computed with NO side effects — mobx forbids them. */
   private get paneListing(): { rows: PickerRow[]; error: string | null } {
      if (this.pane === 'favorites')
         return {
            rows: pickerPrefs().favorites.map((dir) => ({ kind: 'dir', name: contractHome(dir), path: dir })),
            error: null,
         }
      if (this.pane === 'recents')
         return {
            rows: pickerPrefs().recents.map((img) => ({
               kind: 'image',
               name: contractHome(img),
               path: img,
               missing: !existsSync(img),
            })),
            error: null,
         }
      const iv = this.selectedVar
      if (iv == null) return { rows: [], error: null }
      try {
         const listing = listImageDir(this.folder, iv.extensions)
         return {
            rows: [
               ...listing.dirs.map((d): PickerRow => ({ kind: 'dir', name: d, path: resolve(this.folder, d) })),
               ...listing.images.map(
                  (f): PickerRow => ({ kind: 'image', name: f, path: resolve(this.folder, f), missing: false }),
               ),
            ],
            error: null,
         }
      } catch (e) {
         return { rows: [], error: extractErrorMessage(e) }
      }
   }

   get listingError(): string | null {
      return this.paneListing.error
   }

   /** what the overlay renders: pane rows surviving the filter */
   get rows(): PickerRow[] {
      const all = this.paneListing.rows
      if (this.filter === '') return all
      return all.filter((r) => fuzzyMatch(this.filter, r.name))
   }

   get current(): PickerRow | null {
      return this.rows[this.ix] ?? null
   }

   /** feeds the preview reaction: only a real, present image highlights */
   get highlightedImage(): string | null {
      const row = this.current
      return row?.kind === 'image' && !row.missing ? row.path : null
   }

   // ---- navigation ----
   move(delta: number): void {
      const len = this.rows.length
      if (len === 0) return
      this.ix = (this.ix + delta + len) % len
   }

   cyclePane(): void {
      const ix = PICKER_PANES.indexOf(this.pane)
      this.pane = PICKER_PANES[(ix + 1) % PICKER_PANES.length] ?? 'browse'
      this.ix = 0
      this.filter = ''
   }

   private goto(dir: string): void {
      this.pane = 'browse'
      this.folder = dir
      this.ix = 0
      this.filter = ''
   }

   /** `→`: enter the highlighted dir (browse pane; images select via ⏎ only) */
   enter(): void {
      const row = this.current
      if (this.pane === 'browse' && row?.kind === 'dir') this.goto(row.path)
   }

   /** `←`: parent dir (browse pane; the fs root is its own parent) */
   goParent(): void {
      if (this.pane !== 'browse') return
      const parent = parentDir(this.folder)
      if (parent !== this.folder) this.goto(parent)
   }

   /** ⏎: enter a dir (a favorite jumps browse into it), select an image */
   commit(): void {
      const row = this.current
      if (row == null) return
      if (row.kind === 'dir') return this.goto(row.path)
      if (row.missing) return // vanished recent: dim row, never a broken value
      this.select(row.path)
   }

   /** the pick: absolute path into the var, recents + lastFolder recorded */
   private select(absPath: string): void {
      const iv = this.selectedVar
      if (iv == null) return
      iv.set(absPath)
      pickerPrefs().recordPick(absPath)
      this.st.mode = 'nav'
   }

   /** ⌃F: favorite FOLDERS only — a dir row favorites it, an image row favorites the current folder */
   toggleFavorite(): void {
      const row = this.current
      const dir =
         row == null
            ? this.pane === 'browse'
               ? this.folder
               : null
            : row.kind === 'dir'
              ? row.path
              : this.pane === 'browse'
                ? this.folder
                : dirname(row.path)
      if (dir == null) return
      pickerPrefs().toggleFavorite(dir)
      // favorites pane: the row may vanish under the cursor — clamp
      this.ix = Math.max(0, Math.min(this.ix, this.rows.length - 1))
   }

   isFavorite(dir: string): boolean {
      return pickerPrefs().isFavorite(dir)
   }

   // ---- filter (plain chars ALWAYS filter, LorasSt precedent) ----
   filterInput(chunk: string): void {
      this.filter += chunk
      this.ix = 0
   }

   filterBackspace(): void {
      this.filter = this.filter.slice(0, -1)
      this.ix = 0
   }

   /** ⌥⌫ / ⌃W: drop the last word of the filter */
   filterDeleteWord(): void {
      this.filter = this.filter.replace(/\s*\S+\s*$/, '')
      this.ix = 0
   }

   // ---- preview into the shared overlay slot (debounced reaction above) ----
   private _busy: boolean = false

   async refreshPreview(): Promise<void> {
      if (this.st.mode !== 'overlay-image') {
         // debounced close: another overlay may ALREADY own the slot — never wipe its image
         if (!this.st.preview.overlayActive) this.st.preview.clearOverlayImage()
         return
      }
      const path = this.highlightedImage
      if (path == null) {
         // dir row / empty pane: clear so a stale image never lingers
         this.st.preview.clearOverlayImage()
         return
      }
      if (this._busy) return
      this._busy = true
      try {
         // local file: bytes read directly, no host round-trip
         const bytes = new Uint8Array(readFileSync(path))
         if (this.st.preview.useNative) {
            // protocolReadyBytes: kitty draws png only, browsed files can be jpeg/webp
            this.st.preview.setOverlayImage({
               bytes: await protocolReadyBytes(bytes),
               ansi: null,
               name: basename(path),
               note: null,
            })
         } else {
            const ansi = await imageBufferToAnsi(bytes, {
               width: this.st.preview.width,
               height: this.st.preview.height,
            })
            this.st.preview.setOverlayImage({ bytes: null, ansi, name: basename(path), note: null })
         }
      } catch (e) {
         // e.g. a file sharp can't decode — placeholder note, never a crash
         this.st.preview.setOverlayImage({
            bytes: null,
            ansi: null,
            name: basename(path),
            note: extractErrorMessage(e),
         })
      } finally {
         this._busy = false
         // the cursor may have moved while we rendered: catch up once
         if (this.st.mode === 'overlay-image' && this.highlightedImage !== path) void this.refreshPreview()
      }
   }
}
