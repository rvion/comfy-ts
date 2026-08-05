import { imageMeta } from 'image-meta'

// pure escape builders for the two real-image dialects; the painter owns WHEN
// to emit them. Kitty rule one: q=2 on every command, kitty answers graphics
// commands on stdin otherwise, straight into ink's input parser. Accepted
// tradeoff: q=2 also swallows ERROR replies, so a transmit kitty rejects shows
// as a blank panel (listening for replies would race ink's stdin handshakes).

const ESC = '\u001b'
/** APC terminator: ESC backslash */
const ST = '\u001b\\'

/** one OSC 1337 paint: cursor save → CUP → image sized in CELLS → cursor restore */
export function itermImageEscape(bytes: Uint8Array, row: number, col: number, w: number, h: number): string {
   const b64 = Buffer.from(bytes).toString('base64')
   return `${ESC}7${ESC}[${row};${col}H${ESC}]1337;File=inline=1;size=${bytes.byteLength};width=${w};height=${h};preserveAspectRatio=1:${b64}\u0007${ESC}8`
}

/** kitty stretches to the given cell box (no preserveAspectRatio key): fit the
 * box to the image aspect first. Cells are ~1:2 (w:h), same as cornerBox. */
export function fitCellBox(p: { imgW: number; imgH: number; w: number; h: number }): { w: number; h: number } {
   if (p.imgW <= 0 || p.imgH <= 0) return { w: p.w, h: p.h }
   const aspect = p.imgW / p.imgH
   let w = p.w
   let h = Math.max(1, Math.round(w / aspect / 2))
   if (h > p.h) {
      h = p.h
      w = Math.max(1, Math.min(p.w, Math.round(h * aspect * 2)))
   }
   return { w, h }
}

const dimsCache = new WeakMap<Uint8Array, { w: number; h: number }>()

/** header-only parse, cached per bytes object (the painter runs on every flush) */
export function imageDims(bytes: Uint8Array): { w: number; h: number } {
   const hit = dimsCache.get(bytes)
   if (hit != null) return hit
   let dims = { w: 0, h: 0 }
   try {
      const meta = imageMeta(bytes)
      if (meta.width != null && meta.height != null) dims = { w: meta.width, h: meta.height }
   } catch {
      // undecodable header → unfitted box, the terminal still gets the bytes
   }
   dimsCache.set(bytes, dims)
   return dims
}

/** spec cap for one APC payload; continuation chunks carry only the m key */
const KITTY_CHUNK = 4096

/** transmit png data under a fixed image id WITHOUT displaying it (a=t),
 * base64 chunked with m=1/0 continuation */
export function kittyTransmitEscape(bytes: Uint8Array, id: number): string {
   const b64 = Buffer.from(bytes).toString('base64')
   let out = ''
   for (let i = 0; i < b64.length; i += KITTY_CHUNK) {
      const last = i + KITTY_CHUNK >= b64.length
      const ctrl = i === 0 ? `a=t,f=100,t=d,i=${id},q=2,m=${last ? 0 : 1}` : `m=${last ? 0 : 1}`
      out += `${ESC}_G${ctrl};${b64.slice(i, i + KITTY_CHUNK)}${ST}`
   }
   return out
}

/** display a transmitted id at the cursor: same i,p replaces the previous
 * placement, so repaints never accumulate; C=1 keeps the cursor put; z pins
 * stacking (same-z overlaps draw newest-on-top, recency is not a contract) */
export function kittyPlaceEscape(id: number, row: number, col: number, w: number, h: number, z?: number): string {
   const zKey = z == null ? '' : `,z=${z}`
   return `${ESC}7${ESC}[${row};${col}H${ESC}_Ga=p,i=${id},p=1,c=${w},r=${h},C=1,q=2${zKey}${ST}${ESC}8`
}

/** delete this id's placements AND free its data (uppercase I) */
export function kittyDeleteEscape(id: number): string {
   return `${ESC}_Ga=d,d=I,i=${id},q=2${ST}`
}

/** free every image + placement — the quit path: ED does not clear kitty images */
export const KITTY_DELETE_ALL = `${ESC}_Ga=d,d=A,q=2${ST}`

/**
 * per-id transmit-once bookkeeping: data uploads when the bytes OBJECT changes
 * (delete-before-retransmit sidesteps the spec's underspecified reuse of a live
 * id), a cheap placement re-paints every flush, drop deletes exactly once.
 */
export class KittyImageSlot {
   private transmitted: Uint8Array | null = null
   constructor(private id: number) {}

   show(bytes: Uint8Array, row: number, col: number, w: number, h: number, z?: number): string {
      let out = ''
      if (this.transmitted !== bytes) {
         out += kittyDeleteEscape(this.id) + kittyTransmitEscape(bytes, this.id)
         this.transmitted = bytes
      }
      return out + kittyPlaceEscape(this.id, row, col, w, h, z)
   }

   drop(): string {
      if (this.transmitted == null) return ''
      this.transmitted = null
      return kittyDeleteEscape(this.id)
   }
}
