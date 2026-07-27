import { makeAutoObservable, runInAction } from 'mobx'
import sharp from 'sharp'
import { imageBufferToAnsi } from 'src/utils/ansiImage.ts'
import { stripAnsi } from 'src/utils/ansi.ts'
import { extractErrorMessage } from 'src/utils/extractErrorMessage.ts'
import type { PreviewDuringRun, PreviewRenderer } from 'src/cli/tui/state/SettingsSt.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

/** OSC 1337 support: the panel can show REAL images instead of half-blocks */
export function protocolCapable(): boolean {
   if (process.env.COMFY_TS_NO_ITERM_IMAGES === '1') return false
   const term = process.env.TERM_PROGRAM ?? ''
   return term === 'iTerm.app' || term === 'WezTerm' || term === 'vscode' || process.env.LC_TERMINAL === 'iTerm2'
}

type MenuRow = { key: 'panel' | 'renderer' | 'during-run'; label: string; value: string }

/** pixel-renderer 'latent small': replace the output's top rows WHOLE with the
 * right-aligned small latent (each half-block line is self-contained, so
 * whole-line swaps need no mid-line escape surgery) */
export function overlayTopRight(outputAnsi: string | null, latentAnsi: string | null, cols: number): string | null {
   if (latentAnsi == null) return outputAnsi
   const latentLines = latentAnsi.split('\n')
   const latentCols = stripAnsi(latentLines[0] ?? '').length
   const pad = ' '.repeat(Math.max(0, cols - latentCols))
   const overlaid = latentLines.map((l) => pad + l)
   if (outputAnsi == null) return overlaid.join('\n')
   const outLines = outputAnsi.split('\n')
   return [...overlaid, ...outLines.slice(latentLines.length)].join('\n')
}

/** small-latent corner: fraction of the panel each dimension takes */
const CORNER_FRACTION = 0.38
/** pixel renderer can't composite a corner overlay — small latent renders at this fraction */
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
   /** at least one latent frame arrived this run — false + progress = server sends none */
   latentSeenThisRun: boolean = false
   /** last output path, so a settings change can re-render it */
   private lastOutputPath: string | null = null

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
            value: this.renderer + (protocolCapable() ? '' : ' (no protocol support)'),
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
      this.latentSeenThisRun = false
      this.lastOutputPath = null
   }

   /** run boundary: drop the latents so the next run never shows the previous one's */
   clearLatent(): void {
      this.latentAnsi = null
      this.latentBytes = null
      this.latentSeenThisRun = false
   }

   /** re-render the last output for the newly chosen settings */
   onSettingsChanged(): void {
      this.outputAnsi = null
      this.outputBytes = null
      if (this.show && this.lastOutputPath != null) void this.renderOutput(this.lastOutputPath)
   }

   /** what the painter should show RIGHT NOW (native renderer only; mirrors the panel's source) */
   get protocolImage(): Uint8Array | null {
      if (!this.useNative || !this.show || this.menuOpen) return null
      if (this.st.mode === 'overlay-loras') return this.st.loras.previewBytes
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
      if (this.st.mode === 'overlay-loras') return null
      if (this.st.exec.running && this.duringRun === 'latent-small') return this.latentBytes
      return null
   }

   get cornerWidth(): number {
      return Math.max(8, Math.floor(this.width * CORNER_FRACTION))
   }
   get cornerHeight(): number {
      return Math.max(4, Math.floor(this.height * CORNER_FRACTION))
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
      if (!this.show) return
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
      runInAction(() => {
         this.latentSeenThisRun = true
      })
      if (!this.show || this.duringRun === 'last-output') return
      if (this.useNative) {
         // server jpegs pass through untouched — the terminal scales them
         this.latentBytes = bytes
         return
      }
      if (this._busy) return
      this._busy = true
      try {
         // pixel renderer can't composite a corner: 'latent small' renders small, alone
         const small = this.duringRun === 'latent-small'
         const ansi = await imageBufferToAnsi(bytes, {
            width: Math.max(8, Math.floor(this.width * (small ? PIXEL_SMALL_FRACTION : 1))),
            height: Math.max(4, Math.floor(this.height * (small ? PIXEL_SMALL_FRACTION : 1))),
         })
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
