import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { withByteRange } from 'src/cli/serve/byteRange.ts'
import { makeRequestListener } from 'src/cli/serve/run-serve.ts'
import { ServeApp } from 'src/cli/serve/ServeApp.ts'

const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
const flac = { status: 200, contentType: 'audio/flac', body: bytes }

// why we think it is actually a bug, and not just meaning spec should change: WebKit (the panel's
// own app window is a WKWebView) plays audio and video only from a server that answers byte
// ranges, so a flac the panel produced would not play there at all
describe('byte ranges on binary replies', () => {
   it('a whole binary reply says its length and that it takes ranges', () => {
      const r = withByteRange(flac, { method: 'GET' })
      expect(r.status).toBe(200)
      expect(r.headers?.['accept-ranges']).toBe('bytes')
      expect(r.headers?.['content-length']).toBe('10')
   })

   it('a range is answered 206 with just those bytes', () => {
      const r = withByteRange(flac, { method: 'GET', range: 'bytes=2-5' })
      expect(r.status).toBe(206)
      expect([...(r.body as Uint8Array)]).toEqual([2, 3, 4, 5])
      expect(r.headers?.['content-range']).toBe('bytes 2-5/10')
      expect(r.headers?.['content-length']).toBe('4')
   })

   it('open ended and suffix ranges, as media players send them', () => {
      expect([...(withByteRange(flac, { method: 'GET', range: 'bytes=7-' }).body as Uint8Array)]).toEqual([7, 8, 9])
      expect([...(withByteRange(flac, { method: 'GET', range: 'bytes=-2' }).body as Uint8Array)]).toEqual([8, 9])
      expect(withByteRange(flac, { method: 'GET', range: 'bytes=0-999' }).headers?.['content-range']).toBe(
         'bytes 0-9/10',
      )
   })

   it('a range past the end is 416, and json or an error reply is left alone', () => {
      const r = withByteRange(flac, { method: 'GET', range: 'bytes=50-60' })
      expect(r.status).toBe(416)
      expect(r.headers?.['content-range']).toBe('bytes */10')
      const text = { status: 200, contentType: 'application/json', body: '{}' }
      expect(withByteRange(text, { method: 'GET', range: 'bytes=0-1' })).toBe(text)
      const missing = { status: 404, contentType: 'audio/flac', body: bytes }
      expect(withByteRange(missing, { method: 'GET', range: 'bytes=0-1' })).toBe(missing)
   })

   it('an output file over a real socket answers a range request', async () => {
      const root = mkdtempSync(join(tmpdir(), 'comfy-ts-range-'))
      mkdirSync(join(root, 'out', 'songs'), { recursive: true })
      writeFileSync(join(root, 'out', 'songs', 'a.flac'), bytes)
      const server = createServer(makeRequestListener(new ServeApp([], { outputRoot: join(root, 'out') })))
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      const addr = server.address()
      if (addr == null || typeof addr === 'string') throw new Error('no port')
      try {
         const res = await fetch(`http://127.0.0.1:${addr.port}/outputs/songs/a.flac`, {
            headers: { range: 'bytes=0-3' },
         })
         expect(res.status).toBe(206)
         expect(res.headers.get('content-range')).toBe('bytes 0-3/10')
         expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0, 1, 2, 3])
      } finally {
         await new Promise((r) => server.close(r))
      }
   })
})
