import { makeAutoObservable, runInAction } from 'mobx'
import sharp from 'sharp'
import { imageBufferToAnsi } from 'src/utils/ansiImage.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import type { PreviewMode } from 'src/cli/tui/state/SettingsSt.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** OSC 1337 support: the panel can show REAL images instead of half-blocks */
export function protocolCapable(): boolean {
   if (process.env.COMFY_TS_NO_ITERM_IMAGES === '1') return false
   const term = process.env.TERM_PROGRAM ?? ''
   return term === 'iTerm.app' || term === 'WezTerm' || term === 'vscode' || process.env.LC_TERMINAL === 'iTerm2'
}

/**
 * right-side preview panel. The MODE (native/ansi/off) lives in SettingsSt and
 * is cycled with `p`. 'native' overlay-paints the REAL image over the panel rect
 * (protocolImagePainter.ts); 'ansi' renders truecolor half-blocks; 'off' hides
 * the panel. Sources: live latent while running, last output after, selected
 * lora while the loras overlay is open.
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
   /** last output path, so a mode switch can re-render it */
   private lastOutputPath: string | null = null

   get mode(): PreviewMode {
      return this.st.settings.previewMode
   }
   get show(): boolean {
      return this.mode !== 'off'
   }
   /** SettingsSt already downgrades native → ansi on incapable terminals */
   get useNative(): boolean {
      return this.mode === 'native'
   }

   reset(): void {
      this.outputAnsi = null
      this.latentAnsi = null
      this.outputBytes = null
      this.latentBytes = null
      this.lastOutputPath = null
   }

   /** run boundary: drop the latents so the next run never shows the previous one's */
   clearLatent(): void {
      this.latentAnsi = null
      this.latentBytes = null
   }

   /** re-render the last output in the newly chosen mode */
   onModeChanged(): void {
      this.outputAnsi = null
      this.outputBytes = null
      if (this.mode !== 'off' && this.lastOutputPath != null) void this.renderOutput(this.lastOutputPath)
   }

   /** what the painter should show RIGHT NOW (native mode only; mirrors the panel's source) */
   get protocolImage(): Uint8Array | null {
      if (!this.useNative || !this.show) return null
      if (this.st.mode === 'overlay-loras') return this.st.loras.previewBytes
      if (this.st.exec.running && this.latentBytes != null) return this.latentBytes
      return this.outputBytes
   }

   get width(): number {
      // leave ~64 cols to the vars panel (plus the tree), keep the image between 24 and 80 cells
      return Math.max(24, Math.min(80, this.st.termCols - 68 - this.st.treeWidth))
   }

   get height(): number {
      // budget: header 3 + borders 2 + progress 1 + outputs box ~3 + keybar 2
      return Math.max(10, this.st.termRows - 12)
   }

   async renderOutput(path: string): Promise<void> {
      this.lastOutputPath = path
      if (this.mode === 'off') return
      try {
         if (this.useNative) {
            // pre-shrink ONCE: the painter re-uploads on every repaint, so ~100KB beats ~2MB
            const shrunk = await sharp(path)
               .resize(896, 896, { fit: 'inside', withoutEnlargement: true })
               .png()
               .toBuffer()
            runInAction(() => {
               this.outputBytes = new Uint8Array(shrunk)
            })
            return
         }
         const rendered = await imageBufferToAnsi(path, { width: this.width, height: this.height })
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
      if (this.mode === 'off') return
      if (this.useNative) {
         // server jpegs pass through untouched — the terminal scales them
         this.latentBytes = bytes
         return
      }
      if (this._busy) return
      this._busy = true
      try {
         const ansi = await imageBufferToAnsi(bytes, { width: this.width, height: this.height })
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
}
