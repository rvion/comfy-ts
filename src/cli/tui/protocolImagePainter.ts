import { reaction } from 'mobx'
import { protocolCapable } from 'src/cli/tui/state/PreviewSt.ts'
import type { TuiSt } from 'src/cli/tui/state/TuiSt.ts'

type WriteCb = (err?: Error | null) => void

/**
 * paints the REAL image (OSC 1337) over the preview panel's cell rect.
 * Protocol images cannot go THROUGH ink (layout shreds the escape) and every
 * ink frame write ERASES the image's cells — so this hooks stdout.write and
 * re-paints right after each flush, plus a mobx reaction for byte changes that
 * do not move a single frame cell (fresh output/latent/lora bytes).
 * NOT React: effects only fire for the component that re-rendered, which is
 * why a useEffect painter missed frames (his report: image waited for input).
 */
export function installProtocolImagePainter(st: TuiSt): () => void {
   // capability, not current setting: the menu can switch to native at any
   // time — protocolImage returns null while pixel/hidden, so painting no-ops
   if (!protocolCapable() || process.stdout.isTTY !== true) return () => {}
   const original = process.stdout.write.bind(process.stdout)

   const emit = (bytes: Uint8Array, row: number, col: number, w: number, h: number): void => {
      const b64 = Buffer.from(bytes).toString('base64')
      // cursor save → CUP → image sized in CELLS → cursor restore; via the
      // ORIGINAL write so the hook never re-triggers itself
      original(
         `\u001b7\u001b[${row};${col}H\u001b]1337;File=inline=1;size=${bytes.byteLength};width=${w};height=${h};preserveAspectRatio=1:${b64}\u0007\u001b8`,
      )
   }

   const paint = (): void => {
      const pv = st.preview
      const main = pv.protocolImage
      const corner = pv.protocolImageCorner
      if (main == null && corner == null) return
      // panel outer left edge +1 border +1 padding; content row = header(3) + border(1) + 1
      const col = Math.max(1, st.termCols - (pv.width + 4) + 3)
      if (main != null) emit(main, 5, col, pv.width, pv.height)
      // small latent anchored top-right, painted AFTER the big image so it stays on top
      if (corner != null) emit(corner, 5, col + pv.width - pv.cornerWidth, pv.cornerWidth, pv.cornerHeight)
   }

   let scheduled = false
   const schedule = (): void => {
      if (scheduled) return
      scheduled = true
      setImmediate(() => {
         paint()
         scheduled = false
      })
   }

   // cast: whitelist item 8 (agent/coding.md) — reimplements the exact overload set
   const patched = ((chunk: Uint8Array | string, encodingOrCb?: BufferEncoding | WriteCb, cb?: WriteCb): boolean => {
      const res = typeof encodingOrCb === 'function' ? original(chunk, encodingOrCb) : original(chunk, encodingOrCb, cb)
      schedule()
      return res
   }) as typeof process.stdout.write

   process.stdout.write = patched
   const disposeReaction = reaction(() => [st.preview.protocolImage, st.preview.protocolImageCorner], schedule)
   return () => {
      process.stdout.write = original
      disposeReaction()
   }
}
