// pure-JS SHA-1, browser-safe (architecture item 13): replaces node:crypto in
// the core path. Output matches node's createHash('sha1') byte-for-byte —
// upload-dedupe names and preview-cache keys stay identical across the swap
// (vector-tested against node:crypto in tests/sha1.test.ts).

export function sha1Hex(data: Uint8Array): string {
   const ml = data.length
   const total = Math.ceil((ml + 1 + 8) / 64) * 64
   const bytes = new Uint8Array(total)
   bytes.set(data)
   bytes[ml] = 0x80
   const dv = new DataView(bytes.buffer)
   const bitLen = ml * 8
   dv.setUint32(total - 8, Math.floor(bitLen / 2 ** 32))
   dv.setUint32(total - 4, bitLen >>> 0)

   let h0 = 0x67452301
   let h1 = 0xefcdab89
   let h2 = 0x98badcfe
   let h3 = 0x10325476
   let h4 = 0xc3d2e1f0
   const w = new Uint32Array(80)

   for (let i = 0; i < total; i += 64) {
      for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4)
      for (let j = 16; j < 80; j++) {
         const n = (w[j - 3] ?? 0) ^ (w[j - 8] ?? 0) ^ (w[j - 14] ?? 0) ^ (w[j - 16] ?? 0)
         w[j] = (n << 1) | (n >>> 31)
      }
      let a = h0
      let b = h1
      let c = h2
      let d = h3
      let e = h4
      for (let j = 0; j < 80; j++) {
         let f: number
         let k: number
         if (j < 20) {
            f = (b & c) | (~b & d)
            k = 0x5a827999
         } else if (j < 40) {
            f = b ^ c ^ d
            k = 0x6ed9eba1
         } else if (j < 60) {
            f = (b & c) | (b & d) | (c & d)
            k = 0x8f1bbcdc
         } else {
            f = b ^ c ^ d
            k = 0xca62c1d6
         }
         const temp = (((a << 5) | (a >>> 27)) + f + e + k + (w[j] ?? 0)) >>> 0
         e = d
         d = c
         c = (b << 30) | (b >>> 2)
         b = a
         a = temp
      }
      h0 = (h0 + a) >>> 0
      h1 = (h1 + b) >>> 0
      h2 = (h2 + c) >>> 0
      h3 = (h3 + d) >>> 0
      h4 = (h4 + e) >>> 0
   }
   return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('')
}

export function sha1HexOfString(s: string): string {
   return sha1Hex(new TextEncoder().encode(s))
}
