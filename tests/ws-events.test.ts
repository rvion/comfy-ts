// every ws event is routed, ignored by name, or reported once as unknown (architecture.md, ws
// events). tests/fixtures/ws-frames-v0.45.5.json holds one real frame per type a ComfyUI v0.45.5
// host sent during a run and an interrupted run (ids replaced). The broadcasts this box never
// sends (agent host absent, assets system off) are built from the server source below
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { ComfyExecution } from 'src/runner/ComfyExecution.ts'
import { IGNORED_WS_EVENT_TYPES, PromptID_ark, WsMsg_ark } from 'src/runner/ComfyWsApi.ts'
import { ComfyTS } from 'src/state.ts'

const real: { type: string; data: Record<string, unknown> }[] = JSON.parse(
   readFileSync('tests/fixtures/ws-frames-v0.45.5.json', 'utf-8'),
)

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let host: ComfyHost<'ws-events-host'>
beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   const comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-ws-events-')) })
   host = comfy.host({ id: 'ws-events-host', host: '127.0.0.1', port: 65505 })
   host.schema.update({ spec: JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8')), embeddings: [] })
})
afterAll(() => {
   Reflect.deleteProperty(globalThis, 'comfyts')
   if (prior != null) globalHack.comfyts = prior
})

let errors: ReturnType<typeof spyOn<Console, 'error'>>
let logs: ReturnType<typeof spyOn<Console, 'log'>>
beforeEach(() => {
   errors = spyOn(console, 'error')
   logs = spyOn(console, 'log')
})
afterEach(() => {
   errors.mockRestore()
   logs.mockRestore()
   host.executions.clear()
   host._pendingMsgs.clear()
   host['activePromptID'] = null
})

const send = (frame: object): void => host.onMessage({ data: JSON.stringify(frame) } as MessageEvent)
const execution = (id: string): ComfyExecution => {
   const wf = host.workflow({ id: `wf-${id}` })
   return new ComfyExecution(wf, { id: PromptID_ark.assert(id), executed: false, graphID: wf.id }, {})
}

describe('real v0.45.5 frames', () => {
   it('every captured frame matches its schema', () => {
      for (const frame of real) {
         const res = WsMsg_ark(frame)
         expect(res instanceof Error ? `${frame.type}: ${res.message}` : 'ok').toBe('ok')
      }
   })

   it('every captured frame goes through onMessage without a word', () => {
      for (const frame of real) send(frame)
      expect(errors.mock.calls).toEqual([])
      expect(logs.mock.calls.filter((c) => String(c[0]).includes('does not match schema'))).toEqual([])
   })

   it('execution_interrupted ends its execution as a failure carrying the message', () => {
      const frame = real.find((f) => f.type === 'execution_interrupted')
      if (frame == null) throw new Error('fixture: no execution_interrupted frame')
      const exec = execution(String(frame.data['prompt_id']))
      send(frame)
      expect(exec.status).toBe('Failure')
      expect(exec.data.error?.type).toBe('execution_interrupted')
   })

   it('the reconnect resend of the running node (no prompt_id) routes to the active prompt', () => {
      const exec = execution('p-active')
      host['activePromptID'] = PromptID_ark.assert('p-active')
      const seen: string[] = []
      exec.onPromptRelatedMessage = (m) => {
         seen.push(m.type)
      }
      send({ type: 'executing', data: { node: '4' } })
      expect(seen).toEqual(['executing'])
      expect(logs.mock.calls.filter((c) => String(c[0]).includes('does not match schema'))).toEqual([])
   })
})

describe('shapes read from the server source', () => {
   it('execution_error carries current_outputs as a list of node ids', () => {
      const frame = {
         type: 'execution_error',
         data: {
            prompt_id: 'p',
            node_id: '3',
            node_type: 'KSampler',
            executed: ['1'],
            exception_message: 'boom',
            exception_type: 'RuntimeError',
            traceback: ['line'],
            current_inputs: {},
            current_outputs: ['1', '2'],
            timestamp: 1,
         },
      }
      expect(WsMsg_ark(frame) instanceof Error).toBe(false)
   })

   it('executed with a null output (a cached node with no ui payload) matches', () => {
      const frame = { type: 'executed', data: { node: '5', display_node: '5', output: null, prompt_id: 'p' } }
      expect(WsMsg_ark(frame) instanceof Error).toBe(false)
   })
})

describe('ignored by name, unknown once', () => {
   const broadcasts = [
      { type: 'agent_status', data: { state: 'running' } },
      { type: 'asset_export', data: { task_id: 't', progress: 0.5, status: 'running' } },
      {
         type: 'assets.seed.completed',
         data: { phase: 'fast', total: 3, created: 3, enriched: 0, skipped: 0, elapsed: 0.1 },
      },
      {
         type: 'cm-queue-status',
         data: { status: 'in_progress', target: 'x', ui_target: 'nodepack_manager', total_count: 1, done_count: 0 },
      },
      { type: 'cm-task-started', data: { ui_id: 'x', kind: 'install', timestamp: '2026-01-01T00:00:00Z', state: {} } },
   ]

   it('a broadcast sent by design is dropped silently', () => {
      for (const frame of broadcasts) send(frame)
      expect(errors.mock.calls).toEqual([])
      expect(logs.mock.calls).toEqual([])
   })

   it('the ignored list names each family the server and the Manager send', () => {
      for (const frame of broadcasts) expect(IGNORED_WS_EVENT_TYPES).toContain(frame.type as never)
   })

   it('an unknown type is reported once per connection, again after a new session id', () => {
      for (let i = 0; i < 3; i++) send({ type: 'brand-new-event', data: {} })
      expect(errors.mock.calls.length).toBe(1)
      send({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } }, sid: `sid-${Date.now()}` } })
      send({ type: 'brand-new-event', data: {} })
      expect(errors.mock.calls.length).toBe(2)
   })
})
