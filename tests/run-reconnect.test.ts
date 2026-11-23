// a run that outlives a websocket drop: ComfyUI drops every event whose session has no socket, so the
// reconnect asks for the same session (?clientId=) and each run in flight reconciles over http
// (architecture.md, ResilientWebsocket.ts). The end to end proof against a fake ComfyUI, with real
// reconnect pauses, is .shipkit/repros/20261123-run-hangs-after-socket-drop.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { ResilientWebSocketClient, type WsLike } from 'src/host/ResilientWebsocket.ts'
import { ComfyExecution } from 'src/runner/ComfyExecution.ts'
import type { PromptID } from 'src/runner/ComfyWsApi.ts'
import { ComfyTS } from 'src/state.ts'

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let host: ComfyHost<'reconnect-host'>
let queued = new Set<string>()
let history: Record<string, unknown> = {}

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   const comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-reconnect-')) })
   host = comfy.host({ id: 'reconnect-host', host: '127.0.0.1', port: 65504 })
   host.schema.update({ spec: JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8')), embeddings: [] })
   host.fetchFile = async (): Promise<Response> => new Response(new Uint8Array([1, 2, 3]))
   host.fetchQueuedPromptIds = async (): Promise<Set<string>> => queued
   host.fetchHistory = async (id: PromptID): Promise<unknown> => (history[id] == null ? {} : { [id]: history[id] })
})

afterAll(() => {
   Reflect.deleteProperty(globalThis, 'comfyts')
   if (prior != null) globalHack.comfyts = prior
})

const glb = (filename: string): unknown => ({ '3d': [{ filename, subfolder: '', type: 'output' }] })
const successEntry = (id: string, outputs: Record<string, unknown>): unknown => ({
   prompt: [1, id, {}, {}, []],
   outputs,
   status: { status_str: 'success', completed: true, messages: [['execution_success', { prompt_id: id, timestamp: 2 }]] },
})

const runOn = (id: string): { execution: ComfyExecution; first: string; last: string } => {
   const wf = host.workflow({ id })
   const first = wf.builderBase.EmptyLatentImage({}).uid
   const last = wf.builderBase.EmptyLatentImage({ width: 64 }).uid
   const execution = new ComfyExecution(wf, { id: id as PromptID, executed: false, graphID: wf.id })
   execution.historyRetry = { tries: 2, ms: 1 }
   return { execution, first, last }
}

const ws = (m: unknown): Parameters<ComfyExecution['onPromptRelatedMessage']>[0] => m as never

describe('a run in flight when the socket reconnects', () => {
   it('ended on the host while the socket was down: it finishes from /history, outputs heard once', async () => {
      const { execution, first, last } = runOn('r-ended')
      execution.onPromptRelatedMessage(ws({ type: 'executed', data: { node: first, output: glb('a.glb'), prompt_id: 'r-ended' } }))
      history['r-ended'] = successEntry('r-ended', { [first]: glb('a.glb'), [last]: glb('b.glb') })
      await execution.reconcileAfterReconnect()
      await execution.done
      expect(execution.status).toBe('Success')
      expect(execution.models3d.map((m) => m.filename).sort()).toEqual(['a.glb', 'b.glb'])
      // the same end arriving late through the socket is ignored, never a second finish
      execution.onPromptRelatedMessage(ws({ type: 'execution_success', data: { prompt_id: 'r-ended', timestamp: 3 } }))
   })

   it('an error in its history ends it as a Failure with ComfyUI own message', async () => {
      const { execution, first } = runOn('r-error')
      const err = {
         prompt_id: 'r-error',
         node_id: first,
         node_type: 'EmptyLatentImage',
         executed: [],
         exception_message: 'out of memory',
         exception_type: 'torch.OutOfMemoryError',
         traceback: [],
         current_inputs: {},
         current_outputs: [],
      }
      history['r-error'] = { outputs: {}, status: { status_str: 'error', completed: false, messages: [['execution_error', err]] } }
      await execution.reconcileAfterReconnect()
      await execution.done
      expect(execution.status).toBe('Failure')
      expect(execution.data.error?.type).toBe('execution_error')
   })

   it('still queued: it waits, and its end takes the output sent in the gap from /history', async () => {
      const { execution, first, last } = runOn('r-queued')
      queued = new Set(['r-queued'])
      await execution.reconcileAfterReconnect()
      expect(execution.status).toBe('New')
      // the gap swallowed `first`; `last` and the end come through the socket again
      history['r-queued'] = successEntry('r-queued', { [first]: glb('a.glb'), [last]: glb('b.glb') })
      execution.onPromptRelatedMessage(ws({ type: 'executed', data: { node: last, output: glb('b.glb'), prompt_id: 'r-queued' } }))
      execution.onPromptRelatedMessage(ws({ type: 'execution_success', data: { prompt_id: 'r-queued', timestamp: 2 } }))
      await execution.done
      expect(execution.status).toBe('Success')
      expect(execution.models3d.map((m) => m.filename).sort()).toEqual(['a.glb', 'b.glb'])
   })

   it('neither queued nor in /history (the host lost it): it fails instead of waiting forever', async () => {
      const { execution } = runOn('r-lost')
      queued = new Set()
      await execution.reconcileAfterReconnect()
      await execution.done
      expect(execution.status).toBe('Failure')
      expect(execution.data.reason).toContain('neither in its queue nor in its history')
   })

   it('the live end lands while the queue read is in flight: the output of the gap still comes from /history', async () => {
      const { execution, first, last } = runOn('r-race')
      let release: (s: Set<string>) => void = () => {}
      const real = host.fetchQueuedPromptIds
      host.fetchQueuedPromptIds = (): Promise<Set<string>> => new Promise((r) => (release = r))
      const check = execution.reconcileAfterReconnect()
      execution.onPromptRelatedMessage(ws({ type: 'executed', data: { node: last, output: glb('b.glb'), prompt_id: 'r-race' } }))
      execution.onPromptRelatedMessage(ws({ type: 'execution_success', data: { prompt_id: 'r-race', timestamp: 2 } }))
      history['r-race'] = successEntry('r-race', { [first]: glb('a.glb'), [last]: glb('b.glb') })
      release(new Set())
      await check
      await execution.done
      host.fetchQueuedPromptIds = real
      expect(execution.status).toBe('Success')
      expect(execution.models3d.map((m) => m.filename).sort()).toEqual(['a.glb', 'b.glb'])
   })

   it('a queue of another shape (a cloud host) never fails a run as lost', async () => {
      const { execution } = runOn('r-cloud')
      const real = host.fetchQueuedPromptIds
      host.fetchQueuedPromptIds = async (): Promise<Set<string>> => {
         throw new Error('an item of queue_running is not [number, prompt_id, …]')
      }
      expect(await execution.reconcileAfterReconnect()).toBe('waiting')
      host.fetchQueuedPromptIds = real
      expect(execution.status).toBe('New')
   })

   it('control: a run that never reconnected does not ask /history at its end', async () => {
      const { execution, first } = runOn('r-plain')
      let asked = 0
      const real = host.fetchHistory
      host.fetchHistory = async (id: PromptID): Promise<unknown> => (asked++, real(id))
      execution.onPromptRelatedMessage(ws({ type: 'executed', data: { node: first, output: glb('a.glb'), prompt_id: 'r-plain' } }))
      execution.onPromptRelatedMessage(ws({ type: 'execution_success', data: { prompt_id: 'r-plain', timestamp: 2 } }))
      await execution.done
      host.fetchHistory = real
      expect(asked).toBe(0)
      expect(execution.models3d.length).toBe(1)
   })
})

describe('the queue read', () => {
   const answering = (json: unknown): ComfyHost => {
      const comfy = globalHack.comfyts
      if (comfy == null) throw new Error('no comfyts')
      const h = comfy.host({ id: `queue-${Math.random()}`, host: '127.0.0.1', port: 65504 })
      h.fetch = async (): Promise<Response> => Response.json(json)
      return h
   }

   it('reads the prompt ids of ComfyUI queue items', async () => {
      const h = answering({ queue_running: [[3, 'a', {}, {}, []]], queue_pending: [[4, 'b', {}, {}, []]] })
      expect([...(await h.fetchQueuedPromptIds())]).toEqual(['a', 'b'])
   })

   it('refuses a queue whose items have another shape, instead of reading it as empty', async () => {
      const h = answering({ queue_running: [{ prompt_id: 'a' }], queue_pending: [] })
      expect(await h.fetchQueuedPromptIdsOrNull()).toBe(null)
   })
})

describe('the reconnect url', () => {
   it('is read again on every connect, so the host can ask for its session back', async () => {
      const urls: string[] = []
      class Ws implements WsLike {
         binaryType = 'arraybuffer'
         onmessage: WsLike['onmessage'] = null
         onopen: WsLike['onopen'] = null
         onclose: WsLike['onclose'] = null
         onerror: WsLike['onerror'] = null
         constructor(url: string) {
            urls.push(url)
            setTimeout(() => this.onopen?.({}), 1)
            // the first socket dies under the client
            if (urls.length === 1) setTimeout(() => this.onclose?.({ code: 1006, reason: '' }), 3)
         }
         send(): void {}
         close(): void {}
      }
      let session = ''
      const c = new ResilientWebSocketClient({
         url: () => (session === '' ? 'ws://box/ws' : `ws://box/ws?clientId=${session}`),
         onMessage: () => {},
         onConnectOrReconnect: () => void (session = 'abc'),
         onClose: () => {},
         transport: { ctor: Ws, supportsHeaders: true },
         reconnectMs: 1,
      })
      const deadline = Date.now() + 2000
      while (urls.length < 2 && Date.now() < deadline) await Bun.sleep(2)
      c.disconnectPermanently()
      expect(urls).toEqual(['ws://box/ws', 'ws://box/ws?clientId=abc'])
   })
})
