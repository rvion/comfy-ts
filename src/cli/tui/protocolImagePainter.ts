import { reaction } from 'mobx'
import {
   fitCellBox,
   imageDims,
   itermImageEscape,
   KITTY_DELETE_ALL,
   kittyDeleteEscape,
   kittyPlaceEscape,
   kittyTransmitEscape,
} from 'src/cli/tui/imageEscapes.ts'
import { imageProtocol } from 'src/utils/protocolImage.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

type WriteCb = (err?: Error | null) => void

const SYNC_BEGIN = '\u001b[?2026h'
const SYNC_END = '\u001b[?2026l'
/** below this a write is a terminal query/reply, not a frame — no cells damaged */
const MIN_FRAME_BYTES = 64

/** kitty image ids: fixed, transmit-once bookkeeping keys */
const MAIN_ID = 1
const CORNER_ID = 2

/**
 * paints the REAL image (iTerm OSC 1337 / kitty APC _G) over the preview
 * panel's cell rect. Protocol images cannot go THROUGH ink (layout shreds the
 * escape) and every ink frame write ERASES the image's cells — so this hooks
 * stdout.write and re-paints SYNCHRONOUSLY within the same flush, the whole
 * batch wrapped in DEC 2026 synchronized-update markers: the terminal never
 * presents the erased-frame intermediate state. (The previous deferred
 * setImmediate repaint WAS the native-mode flicker.) A mobx reaction covers
 * byte-only changes (fresh latent/output/lora bytes with no frame write).
 * NOT React: effects only fire for the component that re-rendered, which is
 * why a useEffect painter missed frames (reported: the image waited for input).
 * Kitty differs from iterm in three ways the code below encodes: data uploads
 * ONCE per bytes object then a tiny placement re-paints per flush (same i,p
 * replaces); kitty draws images OVER later text, so a gone image needs an
 * explicit delete or it covers the menu; the cell box stretches, so it is
 * fitted to the image aspect first.
 */
export function installProtocolImagePainter(st: TuiSt): () => void {
   // capability, not current setting: the menu can switch to native at any
   // time — imageEscapes() is empty while pixel/hidden, so painting no-ops
   const proto = imageProtocol()
   if (proto == null || process.stdout.isTTY !== true) return () => {}
   const original = process.stdout.write.bind(process.stdout)

   // first image row: header(3) + panel border(1) + 1 content row — row 6,
   // calibrated by playtest on iTerm2 (2026-07-27: row 5 painted one line too high)
   const CONTENT_ROW = 6

   // kitty transmit-once state: which bytes object each image id currently holds
   const transmitted = new Map<number, Uint8Array | null>()

   const kittyShow = (bytes: Uint8Array, id: number, row: number, col: number, w: number, h: number): string => {
      let out = ''
      if (transmitted.get(id) !== bytes) {
         out += kittyDeleteEscape(id) + kittyTransmitEscape(bytes, id)
         transmitted.set(id, bytes)
      }
      return out + kittyPlaceEscape(id, row, col, w, h)
   }

   const kittyDrop = (id: number): string => {
      if (transmitted.get(id) == null) return ''
      transmitted.set(id, null)
      return kittyDeleteEscape(id)
   }

   /** both images as ONE escape string ('' when nothing to paint or delete) */
   const imageEscapes = (): string => {
      const pv = st.preview
      const main = pv.protocolImage
      const corner = pv.protocolImageCorner
      // panel outer left edge +1 border +1 padding
      const col = Math.max(1, st.termCols - (pv.width + 4) + 3)
      if (proto === 'iterm') {
         if (main == null && corner == null) return ''
         let out = ''
         if (main != null) out += itermImageEscape(main, CONTENT_ROW, col, pv.width, pv.height)
         // small latent AFTER the big image so it stays on top; its cell box
         // matches the latent's aspect (cornerBox) — a mismatched rect letterboxes
         if (corner != null) {
            const box = pv.cornerBox
            out += itermImageEscape(corner, CONTENT_ROW, col + pv.width - box.w, box.w, box.h)
         }
         return out
      }
      // kitty: main box fitted to the image dims and centered in the panel rect
      // (iterm letterboxes inside the box itself, kitty stretches)
      let out = ''
      if (main == null) out += kittyDrop(MAIN_ID)
      else {
         const dims = imageDims(main)
         const box = fitCellBox({ imgW: dims.w, imgH: dims.h, w: pv.width, h: pv.height })
         const row = CONTENT_ROW + Math.max(0, Math.floor((pv.height - box.h) / 2))
         const c = col + Math.max(0, Math.floor((pv.width - box.w) / 2))
         out += kittyShow(main, MAIN_ID, row, c, box.w, box.h)
      }
      if (corner == null) out += kittyDrop(CORNER_ID)
      else {
         const box = pv.cornerBox // already aspect-fitted from the latent dims
         out += kittyShow(corner, CORNER_ID, CONTENT_ROW, col + pv.width - box.w, box.w, box.h)
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
      // ED at quit clears iterm images but NOT kitty ones: free them explicitly
      if (proto === 'kitty') original(KITTY_DELETE_ALL)
      process.stdout.write = original
      disposeReaction()
   }
}
