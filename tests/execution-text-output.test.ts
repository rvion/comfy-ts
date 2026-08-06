// a STRING output reaches the client ONLY through an output node's ui payload
// (PreviewAny), how a TextGenerate result gets back to TypeScript.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { ComfyExecution } from 'src/runner/ComfyExecution.ts'
import type { ComfyWorkflow } from 'src/runner/ComfyWorkflow.ts'
import type { PromptID } from 'src/runner/ComfyWsApi.ts'
import type { ComfyNodeId } from 'src/graph/ComfyNodeID.ts'
import { ComfyTS } from 'src/state.ts'

const PROMPT_ID = 'prompt-1' as PromptID

// the global registration is process-wide state (comfyts-singleton precedent):
// run on an OWN temp root, restore whatever another test file registered
const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let host: ComfyHost<'text-host'>

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   const comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-text-')) })
   host = comfy.host({ id: 'text-host', host: '127.0.0.1', port: 65502 })
   const spec = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
   host.schema.update({ spec, embeddings: [] })
})

afterAll(() => {
   Reflect.deleteProperty(globalThis, 'comfyts')
   if (prior != null) (globalThis as { comfyts?: ComfyTS }).comfyts = prior
})

const executionOver = (wf: ComfyWorkflow): ComfyExecution =>
   new ComfyExecution(wf, { id: PROMPT_ID, executed: false, graphID: wf.id })

const executed = (node: ComfyNodeId, output: unknown): Parameters<ComfyExecution['onPromptRelatedMessage']>[0] =>
   // wire tolerance: the ui payload is whatever the output node published
   ({ type: 'executed', data: { node, output, prompt_id: PROMPT_ID } }) as never

describe('text outputs', () => {
   it('collects text entries in arrival order, tagged with the emitting node', () => {
      const wf = host.workflow({ id: 'text-test' })
      const node = wf.builderBase.EmptyLatentImage({})
      const execution = executionOver(wf)

      execution.onPromptRelatedMessage(executed(node.uid, { text: ['first'] }))
      execution.onPromptRelatedMessage(executed(node.uid, { text: ['second', 'third'] }))

      expect(execution.texts.map((t) => t.text)).toEqual(['first', 'second', 'third'])
      expect(execution.texts[0]?.nodeId).toBe(node.uid)
      expect(execution.texts[0]?.nodeKey).toBe('EmptyLatentImage')
      expect(execution.text).toBe('third')
   })

   it('drops non-string entries instead of coercing them', () => {
      const wf = host.workflow({ id: 'text-junk' })
      const node = wf.builderBase.EmptyLatentImage({})
      const execution = executionOver(wf)

      execution.onPromptRelatedMessage(executed(node.uid, { text: [42, null, 'kept', { a: 1 }] }))

      expect(execution.texts.map((t) => t.text)).toEqual(['kept'])
   })

   it('an image-only payload leaves texts empty and `text` null', () => {
      const wf = host.workflow({ id: 'text-none' })
      const node = wf.builderBase.EmptyLatentImage({})
      const execution = executionOver(wf)

      execution.onPromptRelatedMessage(executed(node.uid, {}))

      expect(execution.texts).toEqual([])
      expect(execution.text).toBe(null)
   })
})

// a text node emits NO partial text (probed on ComfyUI 0.27.0: 90 `progress` messages
// carrying only value/max, then ONE `executed` with the whole string). That counter is the
// only thing that moves during a long generation, and the global percent normalizes it away.
describe('the executing node own counter', () => {
   it('rides ExecutionProgress in the node unit, and clears between nodes', () => {
      const wf = host.workflow({ id: 'node-progress' })
      const node = wf.builderBase.EmptyLatentImage({})
      const execution = executionOver(wf)

      expect(execution.progress.nodeProgress).toBe(null)

      execution.onPromptRelatedMessage({
         type: 'executing',
         data: { node: node.uid, prompt_id: PROMPT_ID },
      } as never)
      execution.onPromptRelatedMessage({
         type: 'progress',
         data: { value: 137, max: 1024 },
      } as never)

      expect(execution.progress.nodeProgress).toEqual({ value: 137, max: 1024 })
      expect(execution.progress.nodeName).toBe('EmptyLatentImage')
   })
})
