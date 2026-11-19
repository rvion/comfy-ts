// the run poll: a prompt that samples in about a second must be read several times while it runs,
// or the panel never shows its latent; and once it is done, the panel asks nothing more
import { afterEach, beforeEach, expect, it } from 'bun:test'
import { RunSt } from 'src/cli/serve/web/state/RunSt.ts'

const realFetch = globalThis.fetch
let statusReads = 0
const json = (body: unknown): Response =>
   new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

beforeEach(() => {
   statusReads = 0
   globalThis.fetch = (async (input: string | URL | Request): Promise<Response> => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.startsWith('/run/')) {
         statusReads++
         return json({ running: true, percent: 50, hasPreview: true, previewSeq: statusReads })
      }
      if (url.startsWith('/generate/')) {
         await new Promise((r) => setTimeout(r, 400))
         return json({ promptId: 'p1', module: 'm', draft: 'd', seeds: {}, outputs: [] })
      }
      return json({ runs: [], memory: { usedBytes: 0, budgetBytes: 1, outputs: 0, runs: 0 } })
   }) as typeof fetch
})
afterEach(() => {
   globalThis.fetch = realFetch
})

it('reads the run status several times during a short run, and not at all once it is done', async () => {
   const run = new RunSt()
   run.enqueue({ module: 'm', draft: 'd', payload: {} })
   while (run.queue.length > 0) await new Promise((r) => setTimeout(r, 20))
   expect(statusReads).toBeGreaterThanOrEqual(2)
   const atEnd = statusReads
   await new Promise((r) => setTimeout(r, 300))
   expect(statusReads).toBe(atEnd)
})
