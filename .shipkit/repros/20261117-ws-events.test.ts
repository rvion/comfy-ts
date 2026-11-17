// why we think it is actually a bug, and not just meaning spec should change: ComfyUI v0.45.5 broadcasts agent_status, asset_export and assets.seed.* to every socket and the Manager broadcasts cm-queue-status during installs, by design, and comfy-ts prints a schema dump plus an error and a toast for each such frame; an interrupted prompt gets execution_interrupted and never an execution_success, so execution.done never resolves.
import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { ComfyExecution } from 'src/runner/ComfyExecution.ts'
import { PromptID_ark } from 'src/runner/ComfyWsApi.ts'
import { ComfyTS } from 'src/state.ts'

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let host: ComfyHost<'ws-host'>
beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   const comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-ws-')) })
   host = comfy.host({ id: 'ws-host', host: '127.0.0.1', port: 65504 })
   host.schema.update({ spec: JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8')), embeddings: [] })
})
afterAll(() => {
   Reflect.deleteProperty(globalThis, 'comfyts')
   if (prior != null) globalHack.comfyts = prior
})

const spies = () => ({ error: spyOn(console, 'error'), log: spyOn(console, 'log') })
let s: ReturnType<typeof spies>
afterEach(() => {
   s.error.mockRestore()
   s.log.mockRestore()
})
const send = (frame: object): void => host.onMessage({ data: JSON.stringify(frame) } as MessageEvent)
const noise = (): number => s.error.mock.calls.length + s.log.mock.calls.length

describe('repro: ws events', () => {
   it('control: a status frame is quiet', () => {
      s = spies()
      send({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } }, sid: 'abc' } })
      expect(noise()).toBe(0)
   })

   it('a broadcast the server sends by design is quiet', () => {
      s = spies()
      send({ type: 'agent_status', data: { state: 'running' } })
      send({ type: 'assets.seed.progress', data: { phase: 'fast', scanned: 3, total: 9 } })
      send({ type: 'cm-queue-status', data: { status: 'in_progress', total_count: 1, done_count: 0 } })
      expect(noise()).toBe(0)
   })

   it('an unknown type is reported once, not once per frame', () => {
      s = spies()
      for (let i = 0; i < 3; i++) send({ type: 'some-new-event', data: {} })
      expect(s.error.mock.calls.length).toBe(1)
   })

   it('execution_interrupted finishes the execution', () => {
      s = spies()
      const wf = host.workflow({ id: 'ws-interrupt' })
      const promptId = PromptID_ark.assert('p-interrupt')
      const exec = new ComfyExecution(wf, { id: promptId, executed: false, graphID: wf.id }, {})
      send({
         type: 'execution_interrupted',
         data: { prompt_id: promptId, node_id: '3', node_type: 'KSampler', executed: ['1'], timestamp: 1 },
      })
      expect(exec.status).toBe('Failure')
   })
})
