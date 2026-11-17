// why we think it is actually a bug, and not just meaning spec should change: ComfyUI v0.45.5 ships LoadLoraModel and LoadLoraTextEncoder with a COMFY_DYNAMICGROUP_V3 input, its own frontend saves it as [rowCount, row fields…] and sends `loras.<row>.<field>` keys, and the backend rejects a prompt without them; comfy-ts reads the input as a plain slot, so import throws, export drops the rows, codegen types an opaque tag, and a built graph sends a key the server never accepts.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { parseWorkflowJson } from 'src/litegraph/normalizeWorkflow.ts'
import { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import { classifyWidgetInput } from 'src/sdk-generator/inputWidgetKind.ts'
import { convertLiteGraphToPrompt } from 'src/sdk-generator/litegraphToApiRequestPayload.ts'
import { ComfyTS } from 'src/state.ts'

const spec = JSON.parse(readFileSync('tests/fixtures/object_info-dynamic-group.json', 'utf-8'))
const schema = new ComfySchema({ spec, embeddings: [] })
schema.update({})

const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined
let host: ComfyHost<'group-host'>
beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   const comfy = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-group-')) })
   host = comfy.host({ id: 'group-host', host: '127.0.0.1', port: 65502 })
   host.schema.update({ spec, embeddings: [] })
})
afterAll(() => {
   Reflect.deleteProperty(globalThis, 'comfyts')
   if (prior != null) globalHack.comfyts = prior
})

/** the frontend's save of: ckpt → Load LoRA (Model) with two rows (dynamicGroupWidget.ts run shape) */
const savedWorkflow = {
   version: 0.4,
   links: [[1, 1, 0, 2, 0, 'MODEL']],
   nodes: [
      {
         id: 1,
         type: 'CheckpointLoaderSimple',
         mode: 0,
         pos: [0, 0],
         size: [100, 100],
         outputs: [
            { name: 'MODEL', type: 'MODEL', links: [1] },
            { name: 'CLIP', type: 'CLIP', links: [] },
            { name: 'VAE', type: 'VAE', links: [] },
         ],
         widgets_values: ['model.safetensors'],
      },
      {
         id: 2,
         type: 'LoadLoraModel',
         mode: 0,
         pos: [0, 0],
         size: [100, 100],
         inputs: [
            { name: 'model', type: 'MODEL', link: 1 },
            { name: 'loras.0.lora_name', type: 'COMBO', widget: { name: 'loras.0.lora_name' }, link: null },
            { name: 'loras.0.strength', type: 'FLOAT', widget: { name: 'loras.0.strength' }, link: null },
            { name: 'loras.0.enabled', type: 'BOOLEAN', widget: { name: 'loras.0.enabled' }, link: null },
            { name: 'loras.1.lora_name', type: 'COMBO', widget: { name: 'loras.1.lora_name' }, link: null },
            { name: 'loras.1.strength', type: 'FLOAT', widget: { name: 'loras.1.strength' }, link: null },
            { name: 'loras.1.enabled', type: 'BOOLEAN', widget: { name: 'loras.1.enabled' }, link: null },
         ],
         outputs: [{ name: 'MODEL', type: 'MODEL', links: [] }],
         widgets_values: [2, 'style_a.safetensors', 0.8, true, 'detail.safetensors', 0.5, false],
      },
   ],
}

describe('repro: COMFY_DYNAMICGROUP_V3', () => {
   it('control: a plain combo widget imports', () => {
      const alone = { ...savedWorkflow, links: [], nodes: [savedWorkflow.nodes[0]] }
      const prompt = convertLiteGraphToPrompt(schema, parseWorkflowJson(alone))
      expect(prompt['1']?.inputs).toEqual({ ckpt_name: 'model.safetensors' })
   })

   it('classifier: the group is not a slot', () => {
      const loras = spec.LoadLoraModel.input.required.loras
      expect(classifyWidgetInput({ name: 'loras', type: loras[0], opts: loras[1] }).kind).toBe('dynamic-group')
   })

   it('import: rows become the dotted prompt keys ComfyUI sends', () => {
      const prompt = convertLiteGraphToPrompt(schema, parseWorkflowJson(savedWorkflow))
      expect(prompt['2']?.inputs).toEqual({
         model: ['1', 0],
         'loras.0.lora_name': 'style_a.safetensors',
         'loras.0.strength': 0.8,
         'loras.0.enabled': true,
         'loras.1.lora_name': 'detail.safetensors',
         'loras.1.strength': 0.5,
         'loras.1.enabled': false,
      })
   })

   it('codegen: the group is a typed row array, never the opaque tag', () => {
      const dts = schema.codegenDTS({ hostId: 'group-host' })
      expect(dts).not.toContain('Accepts["COMFY_DYNAMICGROUP_V3"]')
      expect(dts).toContain('loras: [')
   })

   it('programmatic: a row array serializes to dotted keys, defaults filled', () => {
      const wf = host.workflow({ id: 'group-build' })
      const ckpt = wf.builderBase.CheckpointLoaderSimple({ ckpt_name: 'model.safetensors' })
      const node = wf.builderBase.LoadLoraModel({ model: ckpt, loras: [{ lora_name: 'style_b.safetensors' }] })
      expect(wf.toApiJson('use_stringified_numbers_only')[node.uid]?.inputs).toEqual({
         model: [ckpt.uid, 0],
         'loras.0.lora_name': 'style_b.safetensors',
         'loras.0.strength': 1,
         'loras.0.enabled': true,
      })
   })

   it('export: the row run is written the way the editor saves it', async () => {
      const wf = host.workflow({ id: 'group-export' })
      const ckpt = wf.builderBase.CheckpointLoaderSimple({ ckpt_name: 'model.safetensors' })
      wf.builderBase.LoadLoraModel({ model: ckpt, loras: [{ lora_name: 'style_b.safetensors', strength: 0.3 }] })
      const lite = await wf.toWorkflowJson()
      const lora = lite.nodes.find((n) => n.type === 'LoadLoraModel')
      expect(lora?.widgets_values).toEqual([1, 'style_b.safetensors', 0.3, true])
   })
})
