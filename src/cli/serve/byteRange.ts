// HTTP byte ranges on binary replies. WebKit (Safari, and a WKWebView app window) plays audio and
// video only from a server that answers `Range` with 206: without it a flac never starts there
import type { ServeReply } from 'src/cli/serve/ServeApp.ts'

/** one range, the only kind media players send: `bytes=a-b`, `bytes=a-`, `bytes=-n` */
function parseRange(header: string, size: number): { start: number; end: number } | 'unsatisfiable' | null {
   const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
   if (m == null) return null
   const a = m[1] ?? ''
   const b = m[2] ?? ''
   if (a === '' && b === '') return null
   if (a === '') {
      const n = Number(b)
      if (n === 0) return 'unsatisfiable'
      return { start: Math.max(0, size - n), end: size - 1 }
   }
   const start = Number(a)
   const end = b === '' ? size - 1 : Math.min(Number(b), size - 1)
   if (start >= size || start > end) return 'unsatisfiable'
   return { start, end }
}

/** a whole 200 binary reply gets its length and `accept-ranges`; a range request gets 206 with
 * those bytes, or 416 past the end. Text replies and errors pass through untouched */
export function withByteRange(reply: ServeReply, req: { method: string; range?: string }): ServeReply {
   if (req.method !== 'GET' || reply.status !== 200 || typeof reply.body === 'string') return reply
   const size = reply.body.length
   const base = { ...reply.headers, 'accept-ranges': 'bytes' }
   const range = req.range == null ? null : parseRange(req.range, size)
   if (range == null) return { ...reply, headers: { ...base, 'content-length': String(size) } }
   if (range === 'unsatisfiable')
      return {
         status: 416,
         contentType: reply.contentType,
         body: new Uint8Array(0),
         headers: { ...base, 'content-range': `bytes */${size}` },
      }
   return {
      status: 206,
      contentType: reply.contentType,
      body: reply.body.subarray(range.start, range.end + 1),
      headers: {
         ...base,
         'content-range': `bytes ${range.start}-${range.end}/${size}`,
         'content-length': String(range.end - range.start + 1),
      },
   }
}
