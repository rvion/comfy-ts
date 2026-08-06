// an image var can name an http url, which serve fetches on your behalf. The inbound BODY cap
// does not apply to that fetch, so it needs its own, and it has to STOP the read rather than
// measure it afterwards, or a chunked reply exhausts the process before anything checks.
import { describe, expect, it } from 'bun:test'
import { readCapped } from 'src/cli/serve/ServeApp.ts'

/** a chunked body with NO content-length, the shape the size check cannot see coming */
function chunked(p: { chunkBytes: number; chunks: number; onPull?: () => void }): Response {
   let sent = 0
   return new Response(
      new ReadableStream<Uint8Array>({
         pull(controller) {
            p.onPull?.()
            if (sent >= p.chunks) return controller.close()
            sent++
            controller.enqueue(new Uint8Array(p.chunkBytes))
         },
      }),
   )
}

describe('capped download', () => {
   it('reads a body under the cap whole', async () => {
      const bytes = await readCapped(chunked({ chunkBytes: 100, chunks: 5 }), 1000, 'x')
      expect(bytes.length).toBe(500)
   })

   it('STOPS at the cap instead of buffering the whole reply first', async () => {
      let pulls = 0
      const res = chunked({ chunkBytes: 1000, chunks: 10_000, onPull: () => pulls++ })
      await expect(readCapped(res, 5000, 'http://big')).rejects.toThrow('download too large')
      // it read ~6 chunks, not 10_000: the point is that it never materialized the body
      expect(pulls).toBeLessThan(20)
   })

   it('an empty body is empty, not a crash', async () => {
      expect((await readCapped(new Response(null), 10, 'x')).length).toBe(0)
   })

   it('the message names what was too big, never the upstream status', async () => {
      const res = chunked({ chunkBytes: 100, chunks: 100 })
      await expect(readCapped(res, 150, 'http://host/pic.png')).rejects.toThrow('http://host/pic.png')
   })
})
