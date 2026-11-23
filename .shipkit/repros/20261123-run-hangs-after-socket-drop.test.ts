// why we think it is actually a bug, and not just meaning spec should change: the prompt ended with execution_success on the box (its /history says so, its glb downloads in 1.6 s) and `execution.done` never settled, with no error, for 18 minutes; a library whose run can neither end nor fail after a routine websocket reconnect is broken, whatever the spec says about reconnects.
//
// a fake ComfyUI with the routing of its server.py: a socket opened with `?clientId=X` takes the session
// X, any other socket gets a new random session, and an event for a session with no socket is dropped.
// The host's own reconnect pause (2 s) is the floor of each drop case
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'pathe'
import type { ServerWebSocket } from 'bun'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import type { ComfyExecution } from 'src/runner/ComfyExecution.ts'
import { ComfyTS } from 'src/state.ts'

const GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0])

type Sock = ServerWebSocket<{ sid: string }>

class FakeComfy {
   sockets = new Map<string, Sock>()
   opens = 0
   promptCounter = 0
   /** prompt id → the client_id it was posted with */
   clientOf = new Map<string, string>()
   running = new Set<string>()
   history = new Map<string, unknown>()
   outputsOf = new Map<string, Record<string, unknown>>()
   server = Bun.serve<{ sid: string }>({
      port: 0,
      fetch: async (req, srv): Promise<Response | undefined> => {
         const url = new URL(req.url)
         if (url.pathname === '/ws') {
            const sid = url.searchParams.get('clientId') || crypto.randomUUID().replaceAll('-', '')
            if (srv.upgrade(req, { data: { sid } })) return undefined
            return new Response('no upgrade', { status: 400 })
         }
         if (url.pathname === '/api/prompt' && req.method === 'POST') {
            const body = (await req.json()) as { client_id: string }
            const id = `p${++this.promptCounter}`
            this.clientOf.set(id, body.client_id)
            this.running.add(id)
            return Response.json({ prompt_id: id, number: this.promptCounter, node_errors: {} })
         }
         if (url.pathname === '/api/queue') {
            return Response.json({ queue_running: [...this.running].map((id, i) => [i, id, {}, {}, []]), queue_pending: [] })
         }
         if (url.pathname.startsWith('/api/history/')) {
            const id = url.pathname.slice('/api/history/'.length)
            const entry = this.history.get(id)
            return Response.json(entry == null ? {} : { [id]: entry })
         }
         if (url.pathname === '/api/view') return new Response(GLB)
         return new Response('not found', { status: 404 })
      },
      websocket: {
         open: (ws: Sock): void => {
            this.opens++
            this.sockets.set(ws.data.sid, ws)
            ws.send(JSON.stringify({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } }, sid: ws.data.sid } }))
         },
         close: (ws: Sock): void => {
            if (this.sockets.get(ws.data.sid) === ws) this.sockets.delete(ws.data.sid)
         },
         message: (): void => {},
      },
   })

   /** server.py send_json: to the prompt's session, dropped when that session has no socket */
   send(promptId: string, msg: { type: string; data: Record<string, unknown> }): void {
      const sid = this.clientOf.get(promptId)
      const ws = sid != null ? this.sockets.get(sid) : undefined
      ws?.send(JSON.stringify({ ...msg, data: { ...msg.data, prompt_id: promptId } }))
   }

   /** the prompt ends: its events go out as the server sends them, and /history keeps the entry */
   /** an output node ends: its event goes out, and the history entry will list it */
   executed(promptId: string, node: string, filename: string): void {
      const output = { '3d': [{ filename, subfolder: 'comfy-ts', type: 'output' }] }
      this.outputsOf.set(promptId, { ...this.outputsOf.get(promptId), [node]: output })
      this.send(promptId, { type: 'executed', data: { node, display_node: node, output } })
   }

   finish(promptId: string, node: string): void {
      this.executed(promptId, node, 'world_00002_.glb')
      this.send(promptId, { type: 'executing', data: { node: null } })
      this.send(promptId, { type: 'execution_success', data: { timestamp: 2 } })
      this.running.delete(promptId)
      this.history.set(promptId, {
         prompt: [1, promptId, {}, { client_id: this.clientOf.get(promptId) }, [node]],
         outputs: this.outputsOf.get(promptId),
         status: {
            status_str: 'success',
            completed: true,
            messages: [
               ['execution_start', { prompt_id: promptId, timestamp: 1 }],
               ['execution_cached', { nodes: [], prompt_id: promptId, timestamp: 1 }],
               ['execution_success', { prompt_id: promptId, timestamp: 2 }],
            ],
         },
         meta: {},
      })
   }

   /** the socket dies under the client (a heartbeat drop, a proxy idle cut) */
   dropAll(): void {
      for (const ws of this.sockets.values()) ws.close(1006 as never)
      this.sockets.clear()
   }

   async waitOpens(n: number): Promise<void> {
      const deadline = Date.now() + 5000
      while (this.opens < n && Date.now() < deadline) await Bun.sleep(5)
      if (this.opens < n) throw new Error(`the client did not reconnect (opens=${this.opens})`)
   }
}

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let fake: FakeComfy
let host: ComfyHost<'drop-host'>

beforeAll(async () => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   fake = new FakeComfy()
   const comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-drop-')) })
   host = comfy.host({ id: 'drop-host', url: `http://127.0.0.1:${fake.server.port}`, sdkAutoWrite: false })
   mkdirSync(dirname(host.comfyJSONPath), { recursive: true })
   copyFileSync('tests/fixtures/object_info.json', host.comfyJSONPath)
   await host.connect({ schema: 'cache', timeoutMs: 5000 })
})

afterAll(() => {
   host.disconnect()
   void fake.server.stop(true)
   Reflect.deleteProperty(globalThis, 'comfyts')
   if (prior != null) globalHack.comfyts = prior
})

/** `done`, or the word 'hung' after `ms` */
const settle = (e: ComfyExecution, ms: number): Promise<ComfyExecution | 'hung'> =>
   Promise.race([e.done, Bun.sleep(ms).then(() => 'hung' as const)])

const startRun = async (id: string): Promise<{ execution: ComfyExecution; node: string }> => {
   const wf = host.workflow({ id })
   const node = wf.builderBase.EmptyLatentImage({})
   const execution = await wf.start()
   fake.send(execution.data.id, { type: 'execution_start', data: { timestamp: 1 } })
   fake.send(execution.data.id, { type: 'executing', data: { node: node.uid } })
   return { execution, node: node.uid }
}

describe('a run outlives a websocket drop', () => {
   it('control: no drop, the run ends with its glb', async () => {
      const { execution, node } = await startRun('no-drop')
      fake.finish(execution.data.id, node)
      const r = await settle(execution, 2000)
      expect(r).not.toBe('hung')
      expect(execution.status).toBe('Success')
      expect(execution.models3d.length).toBe(1)
   })

   it('the run ends after the drop when the host finished it while the socket was down', async () => {
      const opens = fake.opens
      const { execution, node } = await startRun('ends-in-the-gap')
      fake.dropAll()
      fake.finish(execution.data.id, node) // every end event lands on no socket
      await fake.waitOpens(opens + 1)
      const r = await settle(execution, 3000)
      expect(r).not.toBe('hung')
      expect(execution.status).toBe('Success')
      expect(execution.models3d.length).toBe(1)
   }, 10_000)

   it('the run ends when the host finishes it after the reconnect', async () => {
      const opens = fake.opens
      const { execution, node } = await startRun('ends-after-reconnect')
      fake.dropAll()
      await fake.waitOpens(opens + 1)
      await Bun.sleep(50) // let the reconnect settle before the host speaks
      fake.finish(execution.data.id, node)
      const r = await settle(execution, 3000)
      expect(r).not.toBe('hung')
      expect(execution.status).toBe('Success')
      expect(execution.models3d.length).toBe(1)
   }, 10_000)

   it('an output that ended while the socket was down still reaches the run', async () => {
      const opens = fake.opens
      const wf = host.workflow({ id: 'output-in-the-gap' })
      const first = wf.builderBase.EmptyLatentImage({})
      const last = wf.builderBase.EmptyLatentImage({ width: 64 })
      const execution = await wf.start()
      fake.send(execution.data.id, { type: 'execution_start', data: { timestamp: 1 } })
      fake.dropAll()
      fake.executed(execution.data.id, first.uid, 'world_00001_.glb') // lands on no socket
      await fake.waitOpens(opens + 1)
      await Bun.sleep(50)
      fake.finish(execution.data.id, last.uid)
      const r = await settle(execution, 3000)
      expect(r).not.toBe('hung')
      expect(execution.status).toBe('Success')
      expect(execution.models3d.map((m) => m.filename).sort()).toEqual(['world_00001_.glb', 'world_00002_.glb'])
   }, 10_000)

   it('the run fails loud when the host lost the prompt (restarted while the socket was down)', async () => {
      const opens = fake.opens
      const { execution } = await startRun('lost-prompt')
      fake.dropAll()
      fake.running.delete(execution.data.id) // gone from the queue, never in /history
      await fake.waitOpens(opens + 1)
      const r = await settle(execution, 3000)
      expect(r).not.toBe('hung')
      expect(execution.status).toBe('Failure')
   }, 10_000)
})
