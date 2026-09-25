import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { ServeApp, type ServeModule } from 'src/cli/serve/ServeApp.ts'
import { ComfyTS } from 'src/state.ts'
import { v } from 'src/vars/ComfyVars.ts'

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let comfy: ComfyTS
beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   comfy = ComfyTS.create({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-run-error-')) })
})
afterAll(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
})

/** a run whose ComfyExecution failed with `error` in its data, the way the ws handler stores it */
function failingApp(error: unknown): ServeApp {
   const host = comfy.host({ id: 'err-host', host: '127.0.0.1', port: 65502 })
   const dw = host.defineWorkflow({ id: 'wf', vars: { prompt: v.prompt('hi') }, build: () => {} })
   const mod: ServeModule = { key: 'wf', file: '/fake/wf.cflow.ts', dw }
   return new ServeApp([mod], {
      starter: () =>
         Promise.resolve({ done: Promise.resolve(null), status: 'Failure', images: [], data: { id: 'p1', error } }),
   })
}

async function failReply(error: unknown): Promise<Record<string, unknown>> {
   const reply = await failingApp(error).handle({ method: 'POST', url: '/generate/wf/default', body: '{}' })
   expect(reply.status).toBe(500)
   return JSON.parse(String(reply.body)) as Record<string, unknown>
}

describe('a failed run replies with a readable error string', () => {
   // why we think it is actually a bug, and not just meaning spec should change: every client reads `error` as the message (the panel shows it as "[object Object]"), and ComfyUI's execution_error object carries a real message it never saw
   it('a ComfyUI execution_error becomes "<node type> (node <id>): <type>: <message>"', async () => {
      const body = await failReply({
         type: 'execution_error',
         data: {
            prompt_id: 'p1',
            node_id: '12',
            node_type: 'KSampler',
            executed: [],
            exception_message: 'CUDA out of memory',
            exception_type: 'torch.OutOfMemoryError',
            traceback: ['line 1'],
            current_inputs: {},
            current_outputs: {},
         },
      })
      expect(body.error).toBe('KSampler (node 12): torch.OutOfMemoryError: CUDA out of memory')
   })

   it('control: a plain string error passes through unchanged', async () => {
      expect((await failReply('prompt rejected')).error).toBe('prompt rejected')
   })

   it('an unknown shape is still a string, never an object', async () => {
      expect(typeof (await failReply({ weird: true })).error).toBe('string')
   })
})
