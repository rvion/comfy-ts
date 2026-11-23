// why we think it is actually a bug, and not just meaning spec should change: on windows-1 every upscale run of the upscale explorer (a 12 MP png, 16 to 25 MB, sent by SaveImageWebsocket through the ssh tunnel) ended « Success, no image » within 2 s, while the same runs with host.runSilenceMs at 60 s returned their image; the watchdog read the silence of a frame still in transit as a deaf socket, finished the run from /history (which never holds websocket frames) and reconnected, which drops the frame. An output the server sent and the socket was receiving must never be thrown away.
//
// a run whose graph saves through SaveImageWebsocket goes quiet while its output frame crosses the wire
// (the ws message event fires only once the whole frame is in). Its prompt has already left the queue
// and sits in /history, so a silence check finds it ended there.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { ComfyExecution } from 'src/runner/ComfyExecution.ts'
import type { PromptID } from 'src/runner/ComfyWsApi.ts'
import { ComfyTS } from 'src/state.ts'

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let host: ComfyHost<'big-frame-host'>
let history: Record<string, unknown> = {}

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   const comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-big-frame-')) })
   host = comfy.host({ id: 'big-frame-host', host: '127.0.0.1', port: 65503 })
   host.schema.update({ spec: JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8')), embeddings: [] })
   host.fetchQueuedPromptIds = async (): Promise<Set<string>> => new Set()
   host.fetchHistory = async (id: PromptID): Promise<unknown> => (history[id] == null ? {} : { [id]: history[id] })
})

afterAll(() => {
   Reflect.deleteProperty(globalThis, 'comfyts')
   if (prior != null) globalHack.comfyts = prior
})

const ended = (id: string): unknown => ({
   prompt: [1, id, {}, {}, []],
   outputs: {},
   status: { status_str: 'success', completed: true, messages: [['execution_success', { prompt_id: id, timestamp: 2 }]] },
})

const wsRun = (id: string): ComfyExecution => {
   const wf = host.workflow({ id })
   wf.builderBase.SaveImageWebsocket({ images: wf.builderBase.EmptyImage({}) })
   const execution = new ComfyExecution(wf, { id: id as PromptID, executed: false, graphID: wf.id })
   execution.historyRetry = { tries: 1, ms: 1 }
   history[id] = ended(id)
   return execution
}

const end = (e: ComfyExecution, id: string): void =>
   e.onPromptRelatedMessage({ type: 'execution_success', data: { prompt_id: id, timestamp: 3 } } as never)

describe('a SaveImageWebsocket run silent while its frame crosses the wire', () => {
   it('a silence check waits for the frame instead of finishing from /history', async () => {
      const e = wsRun('big-1')
      e.lastHeardAt = Date.now() - 2000
      await host.reconcileRuns([e], 'silence')
      expect(e.status).not.toBe('Success')
      e.onWsImageOutput({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' })
      end(e, 'big-1')
      await e.done
      expect(e.status).toBe('Success')
      expect(e.images.length).toBe(1)
   })

   it('control: after a reconnect the frame is gone, so the run finishes from /history at once', async () => {
      const e = wsRun('big-2')
      await host.reconcileRuns([e], 'reconnect')
      await e.done
      expect(e.status).toBe('Success')
      expect(e.images.length).toBe(0)
   })
})
