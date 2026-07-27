import { reaction } from 'mobx'
import { protocolCapable } from 'src/cli/tui/state/PreviewSt.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

type WriteCb = (err?: Error | null) => void

const SYNC_BEGIN = '\u001b[?2026h'
const SYNC_END = '\u001b[?2026l'
/** below this a write is a terminal query/reply, not a frame — no cells damaged */
const MIN_FRAME_BYTES = 64

/**
 * paints the REAL image (OSC 1337) over the preview panel's cell rect.
 * Protocol images cannot go THROUGH ink (layout shreds the escape) and every
 * ink frame write ERASES the image's cells — so this hooks stdout.write and
 * re-paints SYNCHRONOUSLY within the same flush, the whole batch wrapped in
 * DEC 2026 synchronized-update markers: the terminal never presents the
 * erased-frame intermediate state. (The previous deferred setImmediate
 * repaint WAS the native-mode flicker — his repro.) A mobx reaction covers
 * byte-only changes (fresh latent/output/lora bytes with no frame write).
 * NOT React: effects only fire for the component that re-rendered, which is
 * why a useEffect painter missed frames (his report: image waited for input).
 */
export function installProtocolImagePainter(st: TuiSt): () => void {
   // capability, not current setting: the menu can switch to native at any
   // time — imageEscapes() is empty while pixel/hidden, so painting no-ops
   if (!protocolCapable() || process.stdout.isTTY !== true) return () => {}
   const original = process.stdout.write.bind(process.stdout)

   const imageEscape = (bytes: Uint8Array, row: number, col: number, w: number, h: number): string => {
      const b64 = Buffer.from(bytes).toString('base64')
      // cursor save → CUP → image sized in CELLS → cursor restore
      return `\u001b7\u001b[${row};${col}H\u001b]1337;File=inline=1;size=${bytes.byteLength};width=${w};height=${h};preserveAspectRatio=1:${b64}\u0007\u001b8`
   }

   // first image row: header(3) + panel border(1) + 1 content row — row 6,
   // calibrated by playtest on iTerm2 (2026-07-27: row 5 painted one line too high)
   const CONTENT_ROW = 6

   /** both images as ONE escape string ('' when nothing to paint) */
   const imageEscapes = (): string => {
      const pv = st.preview
      const main = pv.protocolImage
      const corner = pv.protocolImageCorner
      if (main == null && corner == null) return ''
      // panel outer left edge +1 border +1 padding
      const col = Math.max(1, st.termCols - (pv.width + 4) + 3)
      let out = ''
      if (main != null) out += imageEscape(main, CONTENT_ROW, col, pv.width, pv.height)
      // small latent AFTER the big image so it stays on top; its cell box
      // matches the latent's aspect (cornerBox) — a mismatched rect letterboxes
      if (corner != null) {
         const box = pv.cornerBox
         out += imageEscape(corner, CONTENT_ROW, col + pv.width - box.w, box.w, box.h)
      }
      return out
   }

   // disposed kills PENDING paints too: a repaint queued around ink's final
   // frame must never fire after the alt-screen restore (ghost image after q)
   let disposed = false

   /** byte-only changes (no frame write erased anything): paint alone, atomically */
   let scheduled = false
   const schedule = (): void => {
      if (scheduled || disposed) return
      scheduled = true
      setImmediate(() => {
         scheduled = false
         if (disposed) return
         const images = imageEscapes()
         if (images !== '') original(SYNC_BEGIN + images + SYNC_END)
      })
   }

   // cast: whitelist item 8 (agent/coding.md) — reimplements the exact overload set
   const patched = ((chunk: Uint8Array | string, encodingOrCb?: BufferEncoding | WriteCb, cb?: WriteCb): boolean => {
      // frame writes damage the image cells: repaint in the SAME flush, the
      // whole batch synchronized so no intermediate state is ever presented
      const isFrame = !disposed && (typeof chunk === 'string' ? chunk.length : chunk.byteLength) >= MIN_FRAME_BYTES
      const images = isFrame ? imageEscapes() : ''
      if (images !== '') original(SYNC_BEGIN)
      const res = typeof encodingOrCb === 'function' ? original(chunk, encodingOrCb) : original(chunk, encodingOrCb, cb)
      if (images !== '') original(images + SYNC_END)
      return res
   }) as typeof process.stdout.write

   process.stdout.write = patched
   const disposeReaction = reaction(() => [st.preview.protocolImage, st.preview.protocolImageCorner], schedule)
   return () => {
      disposed = true
      process.stdout.write = original
      disposeReaction()
   }
}
