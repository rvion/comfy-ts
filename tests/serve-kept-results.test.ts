import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { ResultHistory, KEPT_RUNS, type RunRecord } from 'src/cli/serve/resultHistory.ts'
import { ServeApp, type ServeExecution, type ServeModule } from 'src/cli/serve/ServeApp.ts'
import { isEphemeral, mergeKept } from 'src/cli/serve/web/state/keptResults.ts'
import { ComfyTS } from 'src/state.ts'
import { v } from 'src/vars/ComfyVars.ts'

function record(promptId: string, images: number): RunRecord {
   return {
      ok: true,
      module: 'wf',
      draft: 'default',
      promptId,
      durationMs: 1,
      finishedAt: 0,
      seeds: {},
      savedToDisk: false,
      texts: [],
      images: Array.from({ length: images }, (_, ix) => ({
         filename: `${ix}.png`,
         url: `/images/${promptId}/${ix}`,
         absPath: null,
      })),
      audios: [],
   }
}

/** one run with one unsaved image of `bytes` bytes */
function addRun(h: ResultHistory, promptId: string, bytes: number): void {
   const key = `${promptId}/0`
   h.add({
      record: record(promptId, 1),
      imageKeys: [key],
      audioKeys: [],
      blobs: [{ key, bytes: new Uint8Array(bytes), contentType: 'image/png' }],
   })
}

describe('ResultHistory: the last runs, unsaved bytes under one byte budget', () => {
   it('lists runs newest first and serves their bytes', () => {
      const h = new ResultHistory(1000)
      addRun(h, 'a', 10)
      addRun(h, 'b', 10)
      expect(h.list().map((r) => r.promptId)).toEqual(['b', 'a'])
      expect(h.blob('a/0')?.bytes.byteLength).toBe(10)
      expect(h.usage()).toEqual({ usedBytes: 20, budgetBytes: 1000, outputs: 2, runs: 2 })
   })

   it('past the budget the OLDEST bytes go first, and a run left with nothing is dropped', () => {
      const h = new ResultHistory(25)
      addRun(h, 'a', 10)
      addRun(h, 'b', 10)
      addRun(h, 'c', 10)
      expect(h.blob('a/0')).toBeNull()
      expect(h.list().map((r) => r.promptId)).toEqual(['c', 'b'])
      expect(h.usage().usedBytes).toBe(20)
   })

   it('an output whose bytes are gone lists with url null, its run stays for the rest', () => {
      const h = new ResultHistory(15)
      h.add({
         record: record('two', 2),
         imageKeys: ['two/0', 'two/1'],
         audioKeys: [],
         blobs: [
            { key: 'two/0', bytes: new Uint8Array(10), contentType: 'image/png' },
            { key: 'two/1', bytes: new Uint8Array(10), contentType: 'image/png' },
         ],
      })
      const run = h.list()[0]
      expect(run?.images.map((img) => img.url)).toEqual([null, '/images/two/1'])
   })

   it('the newest output stays even alone over budget, so a reply never names a dead url', () => {
      const h = new ResultHistory(5)
      addRun(h, 'big', 50)
      expect(h.blob('big/0')).not.toBeNull()
      addRun(h, 'next', 50)
      expect(h.blob('big/0')).toBeNull()
      expect(h.blob('next/0')).not.toBeNull()
   })

   it('a saved run costs no bytes and survives any budget', () => {
      const h = new ResultHistory(5)
      const saved = record('saved', 1)
      saved.images = [{ filename: 'a.png', url: '/outputs/wf/a.png', absPath: '/out/wf/a.png' }]
      h.add({ record: saved, imageKeys: [null], audioKeys: [], blobs: [] })
      addRun(h, 'mem1', 50)
      addRun(h, 'mem2', 50)
      expect(h.list().map((r) => r.promptId)).toEqual(['mem2', 'saved'])
   })

   it('remove and clear free the bytes at once', () => {
      const h = new ResultHistory(1000)
      addRun(h, 'a', 10)
      addRun(h, 'b', 10)
      h.remove('a')
      expect(h.blob('a/0')).toBeNull()
      expect(h.usage().usedBytes).toBe(10)
      h.clear()
      expect(h.usage()).toEqual({ usedBytes: 0, budgetBytes: 1000, outputs: 0, runs: 0 })
   })

   it('a smaller budget evicts at once', () => {
      const h = new ResultHistory(1000)
      addRun(h, 'a', 10)
      addRun(h, 'b', 10)
      h.setBudget(10)
      expect(h.list().map((r) => r.promptId)).toEqual(['b'])
   })

   it('keeps KEPT_RUNS runs, and a run past the cap frees its bytes', () => {
      const h = new ResultHistory(1_000_000)
      for (let i = 0; i <= KEPT_RUNS; i++) addRun(h, `r${i}`, 1)
      expect(h.list()).toHaveLength(KEPT_RUNS)
      expect(h.blob('r0/0')).toBeNull()
      expect(h.usage().usedBytes).toBe(KEPT_RUNS)
   })
})

describe('the serve routes: a reload gets the last runs back', () => {
   const globalHack = globalThis as { comfyts?: ComfyTS }
   let prior: ComfyTS | undefined
   let comfy: ComfyTS
   beforeAll(() => {
      prior = globalHack.comfyts
      Reflect.deleteProperty(globalThis, 'comfyts')
      comfy = ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-kept-')) })
   })
   afterAll(() => {
      if (prior != null) globalHack.comfyts = prior
      else Reflect.deleteProperty(globalThis, 'comfyts')
   })

   function makeApp(p: { bytes?: number } = {}): ServeApp {
      const host = comfy.host({ id: 'kept-host', host: '127.0.0.1', port: 65501 })
      const dw = host.defineWorkflow({ id: 'wf', vars: { prompt: v.prompt('hi') }, build: () => {} })
      const mod: ServeModule = { key: 'wf', file: '/fake/wf.cflow.ts', dw }
      let n = 0
      return new ServeApp([mod], {
         starter: () => {
            n++
            const images: ServeExecution['images'] = [
               { absPath: null, filename: `img-${n}.png`, buffer: new Uint8Array(p.bytes ?? 8) },
            ]
            return Promise.resolve({ done: Promise.resolve(null), status: 'Success', images, data: { id: `p${n}` } })
         },
      })
   }

   function body(reply: { body: string | Uint8Array }): Record<string, unknown> {
      return JSON.parse(String(reply.body)) as Record<string, unknown>
   }

   async function kept(app: ServeApp): Promise<{ runs: RunRecord[]; memory: { usedBytes: number } }> {
      const b = body(await app.handle({ method: 'GET', url: '/results' }))
      return { runs: b.runs as RunRecord[], memory: b.memory as { usedBytes: number } }
   }

   it('GET /results lists every run, newest first, with the reply the generate gave', async () => {
      const app = makeApp()
      await app.handle({ method: 'PUT', url: '/settings', body: '{"saveToDisk":false}' })
      const first = body(await app.handle({ method: 'POST', url: '/generate/wf/default', body: '{}' }))
      await app.handle({ method: 'POST', url: '/generate/wf/default', body: '{}' })
      const list = await kept(app)
      expect(list.runs.map((r) => r.promptId)).toEqual(['p2', 'p1'])
      expect(list.runs[1]?.images).toEqual(first.images as RunRecord['images'])
      expect(typeof list.runs[0]?.finishedAt).toBe('number')
      expect(list.memory.usedBytes).toBe(16)
   })

   it('DELETE forgets a run and its bytes: a reload does not bring it back', async () => {
      const app = makeApp()
      await app.handle({ method: 'POST', url: '/generate/wf/default', body: '{}' })
      await app.handle({ method: 'POST', url: '/generate/wf/default', body: '{}' })
      expect((await app.handle({ method: 'DELETE', url: '/results/p1' })).status).toBe(200)
      expect((await kept(app)).runs.map((r) => r.promptId)).toEqual(['p2'])
      expect((await app.handle({ method: 'GET', url: '/images/p1/0' })).status).toBe(404)
      await app.handle({ method: 'DELETE', url: '/results' })
      expect((await kept(app)).runs).toEqual([])
   })

   it('the budget is a setting: 1 MB keeps one 600 KB image, and a bad value is a 400', async () => {
      const app = makeApp({ bytes: 600 * 1024 })
      expect((await app.handle({ method: 'PUT', url: '/settings', body: '{"memoryBudgetMb":1}' })).status).toBe(200)
      await app.handle({ method: 'POST', url: '/generate/wf/default', body: '{}' })
      await app.handle({ method: 'POST', url: '/generate/wf/default', body: '{}' })
      expect((await kept(app)).runs.map((r) => r.promptId)).toEqual(['p2'])
      const gone = await app.handle({ method: 'GET', url: '/images/p1/0' })
      expect(gone.status).toBe(404)
      expect(String(gone.body)).toContain('1 MB memory budget')
      expect((await app.handle({ method: 'PUT', url: '/settings', body: '{"memoryBudgetMb":0}' })).status).toBe(400)
      expect((await app.handle({ method: 'PUT', url: '/settings', body: '{"memoryBudgetMb":"big"}' })).status).toBe(400)
      await app.handle({ method: 'PUT', url: '/settings', body: '{"memoryBudgetMb":100}' })
   })
})

describe('the panel merge', () => {
   it('dedupes by promptId, keeps the page copy, orders newest first', () => {
      const merged = mergeKept(
         [{ promptId: 'b', finishedAt: 20, from: 'page' }],
         [
            { promptId: 'a', finishedAt: 10, from: 'server' },
            { promptId: 'b', finishedAt: 20, from: 'server' },
            { promptId: 'c', finishedAt: 30, from: 'server' },
         ],
      )
      expect(merged.map((r) => `${r.promptId}:${r.from}`)).toEqual(['c:server', 'b:page', 'a:server'])
   })

   it('ephemeral = held in memory only: a saved output or an expired one is not', () => {
      expect(isEphemeral({ url: '/images/p/0', absPath: null })).toBe(true)
      expect(isEphemeral({ url: '/outputs/a.png', absPath: '/x/a.png' })).toBe(false)
      expect(isEphemeral({ url: null, absPath: null })).toBe(false)
   })
})
