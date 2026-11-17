// COMFY_DYNAMICGROUP_V3: a widget template repeated as rows (architecture.md, dynamic group).
// The fixture is the real LoadLoraModel / LoadLoraTextEncoder object_info of a ComfyUI v0.45.5
// host, lora names replaced. The saved workflow shape follows the frontend's dynamicGroupWidget.ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import { parseWorkflowJson } from 'src/litegraph/normalizeWorkflow.ts'
import { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import { classifyWidgetInput } from 'src/sdk-generator/inputWidgetKind.ts'
import { convertLiteGraphToPrompt, WorkflowConvertError } from 'src/sdk-generator/litegraphToApiRequestPayload.ts'
import type { ComfyApiJson } from 'src/sdk-generator/comfy-api-json.ts'
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

type RawInput = { name: string; type: string; link: number | null; widget?: { name: string } }
const rowSockets = (rows: number): RawInput[] =>
   Array.from({ length: rows }, (_, row) =>
      (['lora_name', 'strength', 'enabled'] as const).map((field, ix) => {
         const name = `loras.${row}.${field}`
         return { name, type: ['COMBO', 'FLOAT', 'BOOLEAN'][ix] ?? 'COMBO', widget: { name }, link: null }
      }),
   ).flat()

/** ckpt (id 1) → Load LoRA (Model) (id 2), the editor's save */
const saved = (p: {
   widgets: unknown[] | Record<string, unknown>
   rows: number
   links?: unknown[]
   extra?: unknown[]
}) => ({
   version: 0.4,
   links: [[1, 1, 0, 2, 0, 'MODEL'], ...(p.links ?? [])],
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
         inputs: [{ name: 'model', type: 'MODEL', link: 1 }, ...rowSockets(p.rows)],
         outputs: [{ name: 'MODEL', type: 'MODEL', links: [] }],
         widgets_values: p.widgets,
      },
      ...(p.extra ?? []),
   ],
})

const loraInputs = (doc: unknown): ComfyApiJson[string]['inputs'] | undefined =>
   convertLiteGraphToPrompt(schema, parseWorkflowJson(doc))['2']?.inputs

describe('classifier', () => {
   it('reads the template sections as a dynamic group, fields in creation order', () => {
      const loras = spec.LoadLoraModel.input.required.loras
      const kind = classifyWidgetInput({ name: 'loras', type: loras[0], opts: loras[1] })
      if (kind.kind !== 'dynamic-group') throw new Error(`expected dynamic-group, got ${kind.kind}`)
      expect(kind.fields.map((f) => f.name)).toEqual(['lora_name', 'strength', 'enabled'])
      expect([kind.min, kind.max]).toEqual([1, 20])
   })

   it('keeps a matchtype template a slot and an autogrow template a container', () => {
      const matchtype = { template: { template_id: 't', allowed_types: 'IMAGE' } }
      expect(classifyWidgetInput({ name: 'x', type: 'COMFY_MATCHTYPE_V3', opts: matchtype }).kind).toBe('slot')
      const autogrow = { template: { input: { required: { image: ['IMAGE', {}] } }, prefix: 'image', min: 1, max: 3 } }
      expect(classifyWidgetInput({ name: 'x', type: 'COMFY_AUTOGROW_V3', opts: autogrow }).kind).toBe(
         'dynamic-container',
      )
   })
})

describe('import', () => {
   it('positional run [count, row fields…] becomes the dotted prompt keys', () => {
      const widgets = [2, 'style_a.safetensors', 0.8, true, 'detail.safetensors', 0.5, false]
      expect(loraInputs(saved({ widgets, rows: 2 }))).toEqual({
         model: ['1', 0],
         'loras.0.lora_name': 'style_a.safetensors',
         'loras.0.strength': 0.8,
         'loras.0.enabled': true,
         'loras.1.lora_name': 'detail.safetensors',
         'loras.1.strength': 0.5,
         'loras.1.enabled': false,
      })
   })

   it('named widgets_values resolve by widget name', () => {
      const widgets = {
         loras: 1,
         'loras.0.lora_name': 'style_b.safetensors',
         'loras.0.strength': 0.25,
         'loras.0.enabled': true,
      }
      expect(loraInputs(saved({ widgets, rows: 1 }))).toMatchObject({
         'loras.0.lora_name': 'style_b.safetensors',
         'loras.0.strength': 0.25,
      })
   })

   it('a count below min is clamped up and the missing row is schema-filled', () => {
      expect(loraInputs(saved({ widgets: [0], rows: 0 }))).toEqual({
         model: ['1', 0],
         'loras.0.lora_name': 'style_a.safetensors',
         'loras.0.strength': 1,
         'loras.0.enabled': true,
      })
   })

   it('a count above max or not an integer is a typed error', () => {
      for (const count of [21, 1.5, 'two']) {
         let err: unknown
         try {
            loraInputs(saved({ widgets: [count], rows: 0 }))
         } catch (e) {
            err = e
         }
         expect(err).toBeInstanceOf(WorkflowConvertError)
         expect((err as WorkflowConvertError).code).toBe('invalid-widget-value')
      }
   })

   it('a live link on a row field socket wins over its widget value', () => {
      const prim = {
         id: 3,
         type: 'PrimitiveNode',
         mode: 0,
         pos: [0, 0],
         size: [100, 100],
         outputs: [{ name: 'FLOAT', type: 'FLOAT', links: [2] }],
         widgets_values: [0.4],
      }
      const doc = saved({
         widgets: [1, 'style_a.safetensors', 1, true],
         rows: 1,
         links: [[2, 3, 0, 2, 2, 'FLOAT']],
         extra: [prim],
      })
      const lora = doc.nodes[1]
      const strength = lora?.inputs?.find((i) => i.name === 'loras.0.strength')
      if (strength == null) throw new Error('fixture: no strength socket')
      strength.link = 2
      expect(loraInputs(doc)?.['loras.0.strength']).toBe(0.4)
   })
})

describe('codegen', () => {
   const dts = schema.codegenDTS({ hostId: 'group-host' })

   it('types the group as a non-empty array of named row objects', () => {
      expect(dts).toContain('loras: [GroupRow["LoadLoraModel.loras"], ...GroupRow["LoadLoraModel.loras"][]]')
      expect(dts).toContain(
         '"LoadLoraModel.loras": { lora_name: "style_a.safetensors" | "style_b.safetensors" | "detail.safetensors"; strength?: Accepts["FLOAT"]; enabled?: Accepts["BOOLEAN"] }',
      )
      expect(dts).not.toContain('Accepts["COMFY_DYNAMICGROUP_V3"]')
   })
})

describe('programmatic graph', () => {
   it('a row array becomes dotted keys, absent fields filled from the schema', () => {
      const wf = host.workflow({ id: 'group-build' })
      const ckpt = wf.builderBase.CheckpointLoaderSimple({ ckpt_name: 'model.safetensors' })
      const node = wf.builderBase.LoadLoraModel({
         model: ckpt,
         loras: [
            { lora_name: 'style_b.safetensors' },
            { lora_name: 'detail.safetensors', strength: 0.5, enabled: false },
         ],
      })
      expect(wf.toApiJson('use_stringified_numbers_only')[node.uid]?.inputs).toEqual({
         model: [ckpt.uid, 0],
         'loras.0.lora_name': 'style_b.safetensors',
         'loras.0.strength': 1,
         'loras.0.enabled': true,
         'loras.1.lora_name': 'detail.safetensors',
         'loras.1.strength': 0.5,
         'loras.1.enabled': false,
      })
      expect(wf.problems).toEqual([])
   })

   it('an empty array, a missing group or an unknown field is a recorded problem', () => {
      const wf = host.workflow({ id: 'group-bad' })
      const ckpt = wf.builderBase.CheckpointLoaderSimple({ ckpt_name: 'model.safetensors' })
      wf.builderBase.LoadLoraModel({ model: ckpt, loras: [] })
      wf.builderBase.LoadLoraModel({ model: ckpt })
      wf.builderBase.LoadLoraModel({ model: ckpt, loras: [{ lora_name: 'style_a.safetensors', strenght: 2 }] })
      const titles = wf.problems.map((x) => x.title).join('\n')
      expect(titles).toContain('has 0 row(s), the host takes 1 to 20')
      expect(titles).toContain('needs at least 1 row(s)')
      expect(titles).toContain('has no field "strenght"')
   })

   it('export writes the editor run, and the import of that export gives the same prompt', async () => {
      const wf = host.workflow({ id: 'group-export' })
      const ckpt = wf.builderBase.CheckpointLoaderSimple({ ckpt_name: 'model.safetensors' })
      wf.builderBase.LoadLoraModel({ model: ckpt, loras: [{ lora_name: 'style_b.safetensors', strength: 0.3 }] })
      const lite = await wf.toWorkflowJson()
      expect(lite.nodes.find((n) => n.type === 'LoadLoraModel')?.widgets_values).toEqual([
         1,
         'style_b.safetensors',
         0.3,
         true,
      ])
      const back = host.importWorkflowJson(lite, { id: 'group-reimport' })
      expect(back.toApiJson('use_stringified_numbers_only')).toEqual(wf.toApiJson('use_stringified_numbers_only'))
   })

   it('a row field fed by a node output exports as a widget socket and keeps the run aligned', async () => {
      const wf = host.workflow({ id: 'group-linked' })
      const ckpt = wf.builderBase.CheckpointLoaderSimple({ ckpt_name: 'model.safetensors' })
      const other = wf.builderBase.LoadLoraModel({ model: ckpt, loras: [{ lora_name: 'style_a.safetensors' }] })
      // a MODEL output is not a FLOAT: the point is the run shape, not the graph's sense
      wf.builderBase.LoadLoraModel({
         model: other,
         loras: [{ lora_name: 'detail.safetensors', strength: other.outputs.MODEL }],
      })
      const lite = await wf.toWorkflowJson()
      const second = lite.nodes.filter((n) => n.type === 'LoadLoraModel')[1]
      expect(second?.widgets_values).toEqual([1, 'detail.safetensors', 1, true])
      const socket = second?.inputs?.find((i) => i.name === 'loras.0.strength')
      expect(socket?.widget).toEqual({ name: 'loras.0.strength' })
      expect(socket?.link).not.toBeNull()
   })

   it('a prompt json keeps its dotted row keys as they are', () => {
      const api = {
         '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
         '2': {
            class_type: 'LoadLoraModel',
            inputs: {
               model: ['1', 0],
               'loras.0.lora_name': 'style_a.safetensors',
               'loras.0.strength': 0.7,
               'loras.0.enabled': true,
            },
         },
      }
      const imported = host.importApiJson(api, { id: 'group-api' })
      expect(imported.toApiJson('use_stringified_numbers_only')['2']?.inputs).toEqual(api['2'].inputs)
      expect(imported.problems).toEqual([])
   })
})
