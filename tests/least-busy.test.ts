import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { ComfyTS } from 'src/state.ts'
import { v } from 'src/vars/ComfyVars.ts'

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
const servers: ReturnType<typeof Bun.serve>[] = []
beforeEach(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
})
afterEach(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
   for (const s of servers.splice(0)) s.stop(true)
})

/** a fake ComfyUI whose `GET /prompt` reports `queue` jobs */
function fakeHost(comfy: ComfyTS, id: string, queue: number): ComfyHost<string> {
   const server = Bun.serve({
      port: 0,
      fetch: (req) =>
         new URL(req.url).pathname === '/api/prompt'
            ? Response.json({ exec_info: { queue_remaining: queue } })
            : new Response('not found', { status: 404 }),
   })
   servers.push(server)
   return comfy.host({ id, url: `http://127.0.0.1:${server.port}` })
}

/** a port nothing listens on: the connection is refused at once */
function deadHost(comfy: ComfyTS, id: string): ComfyHost<string> {
   const server = Bun.serve({ port: 0, fetch: () => new Response('') })
   const port = server.port
   server.stop(true)
   return comfy.host({ id, url: `http://127.0.0.1:${port}` })
}

function freshComfy(): ComfyTS {
   return ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-leastbusy-')) })
}

describe('comfy.leastBusy', () => {
   test('the shortest server queue wins, ties go to the first host', async () => {
      const comfy = freshComfy()
      const a = fakeHost(comfy, 'a', 3)
      const b = fakeHost(comfy, 'b', 1)
      const c = fakeHost(comfy, 'c', 1)
      expect(await a.fetchQueueSize()).toBe(3)
      expect((await comfy.leastBusy([a, b, c])).data.id).toBe('b')
   })

   test('runs this process started count before the server sees them', async () => {
      const comfy = freshComfy()
      const a = fakeHost(comfy, 'a', 0)
      const b = fakeHost(comfy, 'b', 0)
      a.runsInFlight = 2
      expect((await comfy.leastBusy([a, b])).data.id).toBe('b')
   })

   test('a host that does not answer is skipped', async () => {
      const comfy = freshComfy()
      const down = deadHost(comfy, 'down')
      const up = fakeHost(comfy, 'up', 5)
      expect((await comfy.leastBusy([down, up])).data.id).toBe('up')
   })

   test('every host down throws, naming each one', async () => {
      const comfy = freshComfy()
      const x = deadHost(comfy, 'x')
      const y = deadHost(comfy, 'y')
      const err = await comfy.leastBusy([x, y]).catch((e: unknown) => e)
      expect(String(err)).toContain(`'x'`)
      expect(String(err)).toContain(`'y'`)
   })

   test('a reply without a queue size is an error, never a zero', async () => {
      const comfy = freshComfy()
      const server = Bun.serve({ port: 0, fetch: () => Response.json({ hello: 1 }) })
      servers.push(server)
      const odd = comfy.host({ id: 'odd', url: `http://127.0.0.1:${server.port}` })
      await expect(odd.fetchQueueSize()).rejects.toThrow('queue_remaining')
   })
})

describe('DefinedWorkflow.run reads its vars at the call', () => {
   test('set a var, run, set it again, run: each run keeps its own value', async () => {
      const comfy = freshComfy()
      const host = comfy.host({ id: 'snap', host: '127.0.0.1', port: 65501 })
      const spec: unknown = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
      host.schema.update({ spec, embeddings: [] })
      // the await a real connect takes, without a server
      host.connect = () => Promise.resolve()
      const seen: string[] = []
      const wf = host.defineWorkflow({
         id: 'snap',
         vars: { prompt: v.text('first') },
         build: (_b, vars) => {
            seen.push(vars.prompt)
            throw new Error('stop before sending')
         },
      })
      const first = wf.run()
      expect(host.runsInFlight).toBe(1)
      wf.vars.prompt.value = 'second'
      const second = wf.run()
      expect(host.runsInFlight).toBe(2)
      await Promise.allSettled([first, second])
      expect(seen).toEqual(['first', 'second'])
      expect(host.runsInFlight).toBe(0)
   })
})
