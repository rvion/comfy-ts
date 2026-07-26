import { makeAutoObservable, reaction, runInAction } from 'mobx'
import { fetchLoraPreviewBytes, fetchLoraPreviewMap, loraPreviewKey } from 'src/host/loraManagerApi.ts'
import { imageBufferToAnsi } from 'src/utils/ansiImage.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import { fuzzyMatch } from 'src/utils/fuzzyMatch.ts'
import { LorasVar } from 'src/vars/ComfyVars.ts'
import { getLoraKeyword, setLoraKeyword } from 'src/vars/loraKeywords.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** loras overlay: fuzzy filter + tick/untick + strengths + bulk ops + lora-manager preview */
export class LorasSt {
   constructor(private st: TuiSt) {
      makeAutoObservable<LorasSt, 'st'>(this, { st: false })
      // the selected lora's preview follows the cursor (debounced; renders into the preview panel)
      this.st.disposers.push(
         reaction(
            () => (this.st.mode === 'overlay-loras' ? this.selectedName : null),
            () => void this.refreshPreview(),
            { delay: 120 },
         ),
      )
   }

   ix: number = 0
   filter: string = ''

   /** kind-narrowing cast sanctioned (agent/coding.md), `kind` is the tag */
   get selectedVar(): LorasVar<string> | null {
      const sel = this.st.selected?.[1]
      return sel?.kind === 'loras' ? (sel as LorasVar<string>) : null
   }

   /** options surviving the fuzzy filter (bulk ops apply to exactly these) */
   get filteredNames(): string[] {
      const lv = this.selectedVar
      if (lv == null) return []
      if (this.filter === '') return lv.names
      return lv.names.filter((n) => fuzzyMatch(this.filter, n))
   }

   begin(): void {
      if (this.selectedVar == null) return
      this.st.mode = 'overlay-loras'
      this.ix = 0
      this.filter = ''
   }

   move(delta: number): void {
      const len = this.filteredNames.length
      if (len === 0) return
      this.ix = (this.ix + delta + len) % len
   }

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

   toggle(): void {
      const lv = this.selectedVar
      const name = this.filteredNames[this.ix]
      if (lv == null || name == null) return
      lv.toggleItem(name)
   }

   /** ⌃A / ⌃N: tick / untick every lora surviving the filter */
   setAll(on: boolean): void {
      this.selectedVar?.setAll(on, this.filteredNames)
   }

   adjust(delta: number): void {
      const lv = this.selectedVar
      const name = this.filteredNames[this.ix]
      if (lv == null || name == null) return
      lv.adjustItem(name, delta)
   }

   /** ⌃K: assign the selected lora's trigger keyword (PromptVar prefixes actives with it) */
   beginKeyword(): void {
      const name = this.selectedName
      if (name == null) return
      this.st.editor.beginCustom({
         title: `keyword for ${LorasVar.shortName(name)} (empty clears)`,
         initial: getLoraKeyword(name),
         onCommit: (raw) => {
            setLoraKeyword(name, raw)
            return true
         },
         returnMode: 'overlay-loras',
      })
   }

   // ---- lora-manager previews (optional extension, quiet degrade) ----
   get selectedName(): string | null {
      return this.filteredNames[this.ix] ?? null
   }

   previewAnsi: string | null = null
   /** protocol mode: raw preview bytes for the overlay painter */
   previewBytes: Uint8Array | null = null
   previewName: string | null = null
   /** placeholder line when no image can be shown (missing extension, no preview, video preview…) */
   previewNote: string | null = null

   /** undefined = not fetched yet · null = extension absent */
   private previewMap: Map<string, string> | null | undefined = undefined
   private previewMapHostId: string | null = null
   private _busy: boolean = false

   async refreshPreview(): Promise<void> {
      if (this.st.mode !== 'overlay-loras') {
         runInAction(() => {
            this.previewAnsi = null
            this.previewBytes = null
            this.previewName = null
            this.previewNote = null
         })
         return
      }
      const name = this.selectedName
      if (name == null || this._busy) return
      this._busy = true
      try {
         const host = this.st.wf.host
         if (this.previewMap === undefined || this.previewMapHostId !== host.data.id) {
            this.previewMap = await fetchLoraPreviewMap(host)
            this.previewMapHostId = host.data.id
         }
         const map = this.previewMap
         const url = map?.get(loraPreviewKey(name))
         const note = map == null ? 'lora-manager extension not detected' : url == null ? 'no preview available' : null
         if (url == null) {
            runInAction(() => {
               this.previewAnsi = null
               this.previewBytes = null
               this.previewName = name
               this.previewNote = note
            })
            return
         }
         const bytes = await fetchLoraPreviewBytes(host, url)
         // null covers the SPA index.html fallback (non-image response) too
         if (bytes == null) throw new Error('no image preview on the server')
         if (this.st.preview.useNative) {
            // the overlay painter shows the REAL image — no ansi rendering needed
            runInAction(() => {
               this.previewBytes = bytes
               this.previewAnsi = null
               this.previewName = name
               this.previewNote = null
            })
            return
         }
         const ansi = await imageBufferToAnsi(bytes, { width: this.st.preview.width, height: this.st.preview.height })
         runInAction(() => {
            this.previewAnsi = ansi
            this.previewName = name
            this.previewNote = null
         })
      } catch (e) {
         // e.g. video previews sharp can't decode — placeholder, not an incident
         runInAction(() => {
            this.previewAnsi = null
            this.previewBytes = null
            this.previewName = name
            this.previewNote = extractErrorMessage(e)
         })
      } finally {
         this._busy = false
         // the cursor may have moved while we rendered: catch up once
         if (this.st.mode === 'overlay-loras' && this.selectedName !== name) void this.refreshPreview()
      }
   }
}
