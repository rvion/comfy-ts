import { makeAutoObservable, reaction } from 'mobx'
import { getLoraPreviewUrl, loraMatchesFilter } from 'src/host/loraInfoCache.ts'
import { fetchLoraList, fetchLoraPreviewBytes, loraKey, loraPreviewMapFrom } from 'src/host/loraManagerApi.ts'
import { imageBufferToAnsi } from 'src/utils/ansiImage.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import { LorasVar } from 'src/vars/ComfyVars.ts'
import {
   clearLoraKeywordOverride,
   getLoraKeyword,
   isLoraKeywordFromMirror,
   loraKeywordFromMirror,
   setLoraKeyword,
} from 'src/vars/loraKeywords.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** loras overlay: filter + tick/untick + strengths + bulk ops + lora-manager metadata & preview */
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

   /** the host these loras live on: its mirror is the one that describes them */
   get hostId(): string {
      return this.st.wf.host.data.id
   }

   /**
    * options surviving the filter (bulk ops apply to exactly these).
    * The filter matches the file name OR anything the lora-manager mirror knows:
    * model name, tags, base model, trigger words.
    */
   get filteredNames(): string[] {
      const lv = this.selectedVar
      if (lv == null) return []
      if (this.filter === '') return lv.names
      return lv.names.filter((n) => loraMatchesFilter(n, this.filter, this.hostId))
   }

   begin(): void {
      if (this.selectedVar == null) return
      this.st.mode = 'overlay-loras'
      this.ix = 0
      this.filter = ''
      // fresh overlay starts on the placeholder, never a stale slot image
      this.st.preview.clearOverlayImage()
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
      // the title must be honest about BOTH directions: on a lora the mirror gave
      // trigger words to, empty does not "clear", it stores "inject nothing", and
      // ⌃D is the only way back to the mirror value
      const fromMirror = loraKeywordFromMirror(name, this.hostId)
      const hint =
         fromMirror === ''
            ? 'empty clears'
            : isLoraKeywordFromMirror(name, this.hostId)
              ? 'from lora-manager · empty = inject nothing'
              : `overrides lora-manager · ⌃D restores "${fromMirror}"`
      this.st.editor.beginCustom({
         title: `keyword for ${LorasVar.shortName(name)} (${hint})`,
         initial: getLoraKeyword(name, this.hostId),
         onCommit: (raw) => {
            setLoraKeyword(name, raw, this.hostId)
            return true
         },
         returnMode: 'overlay-loras',
      })
   }

   /** ⌃D: drop the hand keyword, so this lora falls back to lora-manager's trigger words */
   resetKeyword(): void {
      const name = this.selectedName
      if (name == null) return
      clearLoraKeywordOverride(name)
   }

   // ---- lora-manager previews (optional extension, quiet degrade) ----
   get selectedName(): string | null {
      return this.filteredNames[this.ix] ?? null
   }

   /** undefined = not fetched yet · null = extension absent */
   private previewMap: Map<string, string> | null | undefined = undefined
   private previewMapHostId: string | null = null
   private previewSweepStatus: 'ok' | 'partial' | 'absent' | 'unreachable' | null = null
   private _busy: boolean = false

   /** preview goes through PreviewSt's shared overlay slot (one code path with the image picker) */
   async refreshPreview(): Promise<void> {
      if (this.st.mode !== 'overlay-loras') {
         // debounced close: another overlay may ALREADY own the slot — never wipe its image
         if (!this.st.preview.overlayActive) this.st.preview.clearOverlayImage()
         return
      }
      const name = this.selectedName
      if (name == null || this._busy) return
      this._busy = true
      try {
         const host = this.st.wf.host
         // the local mirror answers first (`comfy-ts loras`) — no request at all
         let url = getLoraPreviewUrl(name, host.data.id)
         let miss = 'no preview available'
         if (url == null) {
            // unsynced (or a lora the mirror never saw): ask the live host
            if (this.previewMap === undefined || this.previewMapHostId !== host.data.id) {
               const sweep = await fetchLoraList(host)
               this.previewMap =
                  sweep.status === 'absent' || sweep.status === 'unreachable' ? null : loraPreviewMapFrom(sweep.items)
               this.previewSweepStatus = sweep.status
               this.previewMapHostId = host.data.id
            }
            url = this.previewMap?.get(loraKey(name)) ?? null
            // each miss has its OWN cause, and naming the wrong one sends the user hunting
            if (this.previewSweepStatus === 'absent') miss = 'lora-manager extension not detected'
            else if (this.previewSweepStatus === 'unreachable') miss = 'host unreachable'
            else if (this.previewSweepStatus === 'partial') miss = 'lora-manager answered only part of its list'
         }
         const note = url != null ? null : miss
         if (url == null) {
            this.st.preview.setOverlayImage({ bytes: null, ansi: null, name: `lora ${name}`, note })
            return
         }
         const bytes = await fetchLoraPreviewBytes(host, url)
         // null covers the SPA index.html fallback (non-image response) too
         if (bytes == null) throw new Error('no image preview on the server')
         if (this.st.preview.useNative) {
            // the overlay painter shows the REAL image — no ansi rendering needed
            this.st.preview.setOverlayImage({ bytes, ansi: null, name: `lora ${name}`, note: null })
            return
         }
         const ansi = await imageBufferToAnsi(bytes, { width: this.st.preview.width, height: this.st.preview.height })
         this.st.preview.setOverlayImage({ bytes: null, ansi, name: `lora ${name}`, note: null })
      } catch (e) {
         // e.g. video previews sharp can't decode — placeholder, not an incident
         this.st.preview.setOverlayImage({
            bytes: null,
            ansi: null,
            name: `lora ${name}`,
            note: extractErrorMessage(e),
         })
      } finally {
         this._busy = false
         // the cursor may have moved while we rendered: catch up once
         if (this.st.mode === 'overlay-loras' && this.selectedName !== name) void this.refreshPreview()
      }
   }
}
