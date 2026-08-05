import { makeAutoObservable, runInAction } from 'mobx'
import sharp from 'sharp'
import { imageMeta } from 'image-meta'
import { imageBufferToAnsi } from 'src/utils/ansiImage.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import { imageProtocol, protocolCapable, protocolReadyBytes } from 'src/cli/tui/protocolImage.ts'
import type { PreviewDuringRun, PreviewRenderer } from 'src/cli/tui/state/SettingsSt.ts'
import type { TuiMode, TuiSt } from 'src/cli/tui/state/TuiSt.ts'

type MenuRow = { key: 'panel' | 'renderer' | 'during-run'; label: string; value: string }

/** what an overlay (loras / image picker) wants the panel to show: real bytes
 * (native renderer), an ansi render (pixel), or a placeholder note */
export type OverlayImage = {
   bytes: Uint8Array | null
   ansi: string | null
   name: string | null
   note: string | null
}

/** small-latent corner: fraction of the panel each dimension takes */
const CORNER_FRACTION = 0.38
/** pixel 'latent small': the sharp-composited thumb takes this fraction of the panel */
const PIXEL_SMALL_FRACTION = 0.4

/**
 * right-side preview panel + its `p` settings menu (mode 'preview').
 * Three independent axes live in SettingsSt: panel on/off, renderer
 * native/pixel, and what to show while running (latent / latent small /
 * last output). Sources: live latent while running, last output after,
 * selected lora while the loras overlay is open.
 */
export class PreviewSt {
   constructor(private st: TuiSt) {
      makeAutoObservable<PreviewSt, 'st'>(this, { st: false })
   }

   /** ansi half-block render of the last output image */
   outputAnsi: string | null = null
   /** live latent preview during a run (binary ws frames) */
   latentAnsi: string | null = null
   /** native mode: pre-shrunk output bytes / raw latent jpeg for the painter */
   outputBytes: Uint8Array | null = null
   latentBytes: Uint8Array | null = null
   /** the latent's pixel dimensions (image-meta) — sizes the native corner box */
   latentDims: { width: number; height: number } | null = null
   /** at least one latent frame arrived this run — false + progress = server sends none */
   latentSeenThisRun: boolean = false
   /** last output, kept so a settings change can re-render it: a path when
    * the run saved, raw bytes for memory-only runs (item 14) */
   private lastOutput: string | Uint8Array | null = null

   get show(): boolean {
      return this.st.settings.previewPanel
   }
   get renderer(): PreviewRenderer {
      return this.st.settings.previewRenderer
   }
   get useNative(): boolean {
      return this.renderer === 'native'
   }
   get duringRun(): PreviewDuringRun {
      return this.st.settings.previewDuringRun
   }
   get menuOpen(): boolean {
      return this.st.mode === 'preview'
   }

   // ---- overlay slot: ONE code path for every overlay that previews into the
   // panel (loras + image picker write it; the panel and the protocol painter
   // read it whenever an overlay mode owns the vars area) ----
   overlay: OverlayImage | null = null

   get overlayActive(): boolean {
      return this.st.mode === 'overlay-loras' || this.st.mode === 'overlay-image'
   }

   /** owner = the overlay mode the render was FOR: every writer awaits (file
    * read, fetch, transcode) before landing here, and by then another overlay
    * can own the slot — a stale write would overwrite its image */
   setOverlayImage(p: OverlayImage, owner: TuiMode): void {
      if (this.st.mode !== owner) return
      this.overlay = p
   }

   clearOverlayImage(): void {
      this.overlay = null
   }
   /** running + latents wanted + sampling well underway + none arrived = server
    * sends none. The ≥20% gate keeps healthy runs from red-flashing: the first
    * progress tick lands a beat before the first preview frame */
   get latentsMissing(): boolean {
      return (
         this.st.exec.running &&
         this.duringRun !== 'last-output' &&
         (this.st.exec.progress?.percent ?? 0) >= 20 &&
         !this.latentSeenThisRun
      )
   }

   // ---- `p` settings menu (rendered by PreviewPanel while mode === 'preview') ----
   menuIx: number = 0

   get menuRows(): MenuRow[] {
      return [
         { key: 'panel', label: 'panel', value: this.show ? 'on' : 'off' },
         {
            key: 'renderer',
            label: 'renderer',
            value: this.renderer + (protocolCapable() ? '' : ' (this terminal cannot show real images)'),
         },
         {
            key: 'during-run',
            label: 'while running',
            value:
               this.duringRun === 'latent'
                  ? 'latent'
                  : this.duringRun === 'latent-small'
                    ? 'latent small'
                    : 'last output',
         },
      ]
   }

   beginMenu(): void {
      this.st.mode = 'preview'
      this.menuIx = 0
   }

   blurMenu(): void {
      this.st.mode = 'nav'
   }

   menuMove(delta: number): void {
      const len = this.menuRows.length
      this.menuIx = (this.menuIx + delta + len) % len
   }

   /** cycle the selected row's value (settings persist via SettingsSt reaction) */
   menuCycle(delta: number): void {
      const row = this.menuRows[this.menuIx]
      if (row == null) return
      const s = this.st.settings
      if (row.key === 'panel') {
         s.previewPanel = !s.previewPanel
      } else if (row.key === 'renderer') {
         // no protocol support → native is unreachable, pixel is the only value
         if (protocolCapable()) s.previewRenderer = s.previewRenderer === 'native' ? 'pixel' : 'native'
      } else {
         const order: PreviewDuringRun[] = ['latent', 'latent-small', 'last-output']
         const ix = (order.indexOf(s.previewDuringRun) + delta + order.length) % order.length
         s.previewDuringRun = order[ix] ?? 'latent'
      }
      this.onSettingsChanged()
   }

   reset(): void {
      this.outputAnsi = null
      this.latentAnsi = null
      this.outputBytes = null
      this.latentBytes = null
      this.latentDims = null
      this.latentSeenThisRun = false
      this.lastOutput = null
   }

   /** run boundary: drop the latents so the next run never shows the previous one's */
   clearLatent(): void {
      this.latentAnsi = null
      this.latentBytes = null
      this.latentDims = null
      this.latentSeenThisRun = false
   }

   /** re-render the last output for the newly chosen settings */
   onSettingsChanged(): void {
      this.outputAnsi = null
      this.outputBytes = null
      if (this.show && this.lastOutput != null) void this.renderOutput(this.lastOutput)
   }

   /** what the painter should show RIGHT NOW (native renderer only; mirrors the panel's source) */
   get protocolImage(): Uint8Array | null {
      if (!this.useNative || !this.show || this.menuOpen) return null
      if (this.overlayActive) return this.overlay?.bytes ?? null
      if (this.st.exec.running) {
         if (this.duringRun === 'latent') return this.latentBytes ?? this.outputBytes
         // latent-small keeps the OUTPUT big (corner carries the latent) — last-output too
         return this.outputBytes
      }
      return this.outputBytes
   }

   /** small latent painted over the panel's top-right corner (native + 'latent small' only) */
   get protocolImageCorner(): Uint8Array | null {
      if (!this.useNative || !this.show || this.menuOpen) return null
      if (this.overlayActive) return null
      if (this.st.exec.running && this.duringRun === 'latent-small') return this.latentBytes
      return null
   }

   /** corner cell box matched to the latent's REAL aspect (a mismatched box
    * letterboxes in iTerm, showing a tall rectangle). Cells are
    * ~1:2 (w:h), hence the ×2 when converting image aspect to cells. */
   get cornerBox(): { w: number; h: number } {
      let w = Math.max(8, Math.floor(this.width * CORNER_FRACTION))
      const maxH = Math.max(4, Math.floor(this.height * CORNER_FRACTION))
      const dims = this.latentDims
      if (dims == null || dims.width === 0 || dims.height === 0) return { w, h: maxH }
      const aspect = dims.width / dims.height
      let h = Math.max(2, Math.round(w / aspect / 2))
      if (h > maxH) {
         h = maxH
         w = Math.max(4, Math.round(h * aspect * 2))
      }
      return { w, h }
   }

   get width(): number {
      // leave ~64 cols to the vars panel (plus the tree), keep the image between 24 and 80 cells
      return Math.max(24, Math.min(80, this.st.termCols - 68 - this.st.treeWidth))
   }

   get height(): number {
      // budget: header 3 + borders 2 + progress 1 + outputs box ~3 + keybar 2
      return Math.max(10, this.st.termRows - 12)
   }

   async renderOutput(src: string | Uint8Array): Promise<void> {
      this.lastOutput = src
      if (!this.show) return
      try {
         if (this.useNative) {
            // pre-shrink ONCE: the painter re-uploads on every repaint, so ~100KB beats ~2MB
            const shrunk = await sharp(src)
               .resize(896, 896, { fit: 'inside', withoutEnlargement: true })
               .png()
               .toBuffer()
            runInAction(() => {
               this.outputBytes = new Uint8Array(shrunk)
            })
            return
         }
         const rendered = await imageBufferToAnsi(src, { width: this.width, height: this.height })
         runInAction(() => {
            this.outputAnsi = rendered
         })
      } catch (e) {
         // preview failure must be VISIBLE (outputs list still shows the paths)
         runInAction(() => {
            this.st.exec.notice = `preview: ${extractErrorMessage(e)}`
         })
      }
   }

   /** skip-while-busy: latent frames arrive faster than sharp renders them */
   private _busy: boolean = false
   async renderLatent(bytes: Uint8Array): Promise<void> {
      runInAction(() => {
         this.latentSeenThisRun = true
      })
      if (!this.show || this.duringRun === 'last-output') return
      if (this.useNative) {
         // dims feed cornerBox so the corner rect matches the image aspect
         const meta = imageMeta(bytes)
         const dims = meta.width != null && meta.height != null ? { width: meta.width, height: meta.height } : null
         if (imageProtocol() !== 'kitty') {
            // iterm scales any format: server jpegs pass through untouched
            this.latentBytes = bytes
            this.latentDims = dims
            return
         }
         // kitty draws png only: transcode, busy-guarded like the pixel path
         if (this._busy) return
         this._busy = true
         try {
            const png = await protocolReadyBytes(bytes)
            runInAction(() => {
               this.latentBytes = png
               this.latentDims = dims
            })
         } catch (e) {
            runInAction(() => {
               this.st.exec.notice = `latent preview: ${extractErrorMessage(e)}`
            })
         } finally {
            this._busy = false
         }
         return
      }
      if (this._busy) return
      this._busy = true
      try {
         const ansi =
            this.duringRun === 'latent-small'
               ? await this.renderLatentSmallPixel(bytes)
               : await imageBufferToAnsi(bytes, { width: this.width, height: this.height })
         runInAction(() => {
            this.latentAnsi = ansi
         })
      } catch (e) {
         runInAction(() => {
            this.st.exec.notice = `latent preview: ${extractErrorMessage(e)}`
         })
      } finally {
         this._busy = false
      }
   }

   /** pixel 'latent small': sharp-composite the latent thumb onto the last
    * output (top-right), then ONE half-block render — a string-level overlay
    * was tried and dropped: its space padding reads as black bars */
   private async renderLatentSmallPixel(bytes: Uint8Array): Promise<string> {
      const pxW = this.width
      const pxH = this.height * 2
      const thumb = await sharp(bytes)
         .resize(
            Math.max(8, Math.floor(pxW * PIXEL_SMALL_FRACTION)),
            Math.max(8, Math.floor(pxH * PIXEL_SMALL_FRACTION)),
            { fit: 'inside' },
         )
         .png()
         .toBuffer()
      const out = this.lastOutput
      if (out == null) return imageBufferToAnsi(thumb, { width: this.width, height: this.height })
      const base = await sharp(out).resize(pxW, pxH, { fit: 'inside' }).png().toBuffer()
      const composed = await sharp(base)
         .composite([{ input: thumb, gravity: 'northeast' }])
         .png()
         .toBuffer()
      return imageBufferToAnsi(composed, { width: this.width, height: this.height })
   }
}
