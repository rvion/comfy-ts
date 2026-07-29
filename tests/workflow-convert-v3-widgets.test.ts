import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseWorkflowJson } from 'src/litegraph/normalizeWorkflow.ts'
import { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import { convertLiteGraphToPrompt, WorkflowConvertError } from 'src/sdk-generator/litegraphToApiRequestPayload.ts'
import type { ComfyApiJson } from 'src/sdk-generator/comfy-api-json.ts'

// 2026-era object_info: V3 string-spelled widget types (COMBO with options,
// COMFY_DYNAMICCOMBO_V3, COMFY_AUTOGROW_V3, IMAGECOMPARE socketless,
// widgetType file unions) — real core-node entries, trimmed
const spec = JSON.parse(readFileSync('tests/fixtures/object_info-v3-widgets.json', 'utf-8'))
const schema = new ComfySchema({ spec, embeddings: [] })
schema.update({})

type RawNode = {
   id: number
   type: string
   mode?: number
   pos: number[]
   size: number[]
   inputs?: { name: string; type: string; link: number | null; widget?: { name: string } }[]
   outputs?: { name: string; type: string; links: number[] | null }[]
   widgets_values?: unknown[] | Record<string, unknown>
}
type RawLinkTuple = [number, number, number, number, number, string]
type RawWf = { nodes: RawNode[]; links: RawLinkTuple[]; version: number }

const PRODUCER: RawNode = {
   id: 1,
   type: 'TestProducer',
   mode: 0,
   pos: [0, 0],
   size: [100, 100],
   outputs: [
      { name: 'VIDEO', type: 'VIDEO', links: [10] },
      { name: 'IMAGE', type: 'IMAGE', links: [11, 12] },
      { name: 'AUDIO', type: 'AUDIO', links: [13] },
      { name: 'VOXEL', type: 'VOXEL', links: [14] },
      { name: 'STRING', type: 'STRING', links: [15] },
      { name: '*', type: '*', links: [16] },
   ],
}

const doc = (node: RawNode, links: RawLinkTuple[]): RawWf => ({
   version: 0.4,
   nodes: [PRODUCER, node],
   links,
})

const convert = (raw: RawWf): ComfyApiJson => convertLiteGraphToPrompt(schema, parseWorkflowJson(raw))

const expectConvertError = (raw: RawWf, code: WorkflowConvertError['code']): void => {
   let err: unknown
   try {
      convert(raw)
   } catch (e) {
      err = e
   }
   expect(err).toBeInstanceOf(WorkflowConvertError)
   expect((err as WorkflowConvertError).code).toBe(code)
}

describe('V3 widget spellings: COMBO with options config', () => {
   it('SaveVideo consumes [filename_prefix, format, codec] positionally (his canonical repro)', () => {
      const prompt = convert(
         doc(
            {
               id: 2,
               type: 'SaveVideo',
               mode: 0,
               pos: [0, 0],
               size: [100, 100],
               inputs: [{ name: 'video', type: 'VIDEO', link: 10 }],
               widgets_values: ['video/ComfyUI', 'auto', 'auto'],
            },
            [[10, 1, 0, 2, 0, 'VIDEO']],
         ),
      )
      expect(prompt['2']).toEqual({
         class_type: 'SaveVideo',
         inputs: { video: ['1', 0], filename_prefix: 'video/ComfyUI', format: 'auto', codec: 'auto' },
      })
   })

   it('VoxelToMesh: COMBO without default still consumes its positional value', () => {
      const prompt = convert(
         doc(
            {
               id: 2,
               type: 'VoxelToMesh',
               mode: 0,
               pos: [0, 0],
               size: [100, 100],
               inputs: [{ name: 'voxel', type: 'VOXEL', link: 14 }],
               widgets_values: ['surface net', 0.6],
            },
            [[14, 1, 3, 2, 0, 'VOXEL']],
         ),
      )
      expect(prompt['2']?.inputs['algorithm']).toBe('surface net')
      expect(prompt['2']?.inputs['threshold']).toBe(0.6)
   })
})

describe('trailing widget growth: schema-default fill', () => {
   it('CreateVideo bit_depth (2026 growth past the serialized array) fills the schema default (his corpus repro)', () => {
      const prompt = convert(
         doc(
            {
               id: 2,
               type: 'CreateVideo',
               mode: 0,
               pos: [0, 0],
               size: [100, 100],
               inputs: [
                  { name: 'images', type: 'IMAGE', link: 11 },
                  { name: 'audio', type: 'AUDIO', link: 13 },
               ],
               widgets_values: [25],
            },
            [
               [11, 1, 1, 2, 0, 'IMAGE'],
               [13, 1, 2, 2, 1, 'AUDIO'],
            ],
         ),
      )
      expect(prompt['2']).toEqual({
         class_type: 'CreateVideo',
         inputs: { images: ['1', 1], audio: ['1', 2], fps: 25, bit_depth: 8 },
      })
   })
})

describe('COMFY_DYNAMICCOMBO_V3: key + selected branch consumed inline', () => {
   const resize = (widgets: unknown[], extraInputs: RawNode['inputs'] = [], extraLinks: RawLinkTuple[] = []): RawWf =>
      doc(
         {
            id: 2,
            type: 'ResizeImageMaskNode',
            mode: 0,
            pos: [0, 0],
            size: [100, 100],
            inputs: [{ name: 'input', type: 'IMAGE,MASK', link: 11 }, ...(extraInputs ?? [])],
            widgets_values: widgets,
         },
         [[11, 1, 1, 2, 0, 'IMAGE'], ...extraLinks],
      )

   it('single-widget branch: ["scale total pixels", 1, "area"] → key + dotted megapixels + scale_method', () => {
      const prompt = convert(resize(['scale total pixels', 1, 'area']))
      expect(prompt['2']).toEqual({
         class_type: 'ResizeImageMaskNode',
         inputs: {
            input: ['1', 1],
            resize_type: 'scale total pixels',
            'resize_type.megapixels': 1,
            scale_method: 'area',
         },
      })
   })

   it('multi-widget branch: ["scale dimensions", 512, 768, "center", "area"] consumes width+height+crop', () => {
      const prompt = convert(resize(['scale dimensions', 512, 768, 'center', 'area']))
      expect(prompt['2']?.inputs['resize_type.width']).toBe(512)
      expect(prompt['2']?.inputs['resize_type.height']).toBe(768)
      expect(prompt['2']?.inputs['resize_type.crop']).toBe('center')
      expect(prompt['2']?.inputs['scale_method']).toBe('area')
   })

   it('branch with a LINK slot: "match size" resolves the dotted serialized input', () => {
      const prompt = convert(
         resize(
            ['match size', 'center', 'area'],
            [{ name: 'resize_type.match', type: 'IMAGE,MASK', link: 12 }],
            [[12, 1, 1, 2, 1, 'IMAGE']],
         ),
      )
      expect(prompt['2']?.inputs['resize_type']).toBe('match size')
      expect(prompt['2']?.inputs['resize_type.match']).toEqual(['1', 1])
      expect(prompt['2']?.inputs['resize_type.crop']).toBe('center')
   })

   it('unknown key throws typed unknown-dynamic-combo-option (host drift, same class as unknown-node)', () => {
      expectConvertError(resize(['no such branch', 1, 'area']), 'unknown-dynamic-combo-option')
   })
})

describe('COMFY_AUTOGROW_V3: dynamic container, zero widget values', () => {
   it('ComfyMathExpression: values.a link satisfies the container; expression consumes the only positional (his corpus repro)', () => {
      const prompt = convert(
         doc(
            {
               id: 2,
               type: 'ComfyMathExpression',
               mode: 0,
               pos: [0, 0],
               size: [100, 100],
               inputs: [
                  { name: 'values.a', type: 'FLOAT,INT,BOOLEAN', link: 16 },
                  { name: 'values.b', type: 'FLOAT,INT,BOOLEAN', link: null },
               ],
               widgets_values: ['a'],
            },
            [[16, 1, 5, 2, 0, '*']],
         ),
      )
      expect(prompt['2']).toEqual({
         class_type: 'ComfyMathExpression',
         inputs: { expression: 'a', 'values.a': ['1', 5] },
      })
   })

   it('missing required instance (template.min = 1, no values.a) throws typed missing-required-input', () => {
      expectConvertError(
         doc(
            {
               id: 2,
               type: 'ComfyMathExpression',
               mode: 0,
               pos: [0, 0],
               size: [100, 100],
               inputs: [],
               widgets_values: ['a'],
            },
            [],
         ),
         'missing-required-input',
      )
   })
})

describe('socketless custom widgets (IMAGECOMPARE)', () => {
   const compare = (widgets: unknown[]): RawWf =>
      doc(
         {
            id: 2,
            type: 'ImageCompare',
            mode: 0,
            pos: [0, 0],
            size: [100, 100],
            inputs: [
               { name: 'image_a', type: 'IMAGE', link: 11 },
               { name: 'image_b', type: 'IMAGE', link: 12 },
            ],
            widgets_values: widgets,
         },
         [
            [11, 1, 1, 2, 0, 'IMAGE'],
            [12, 1, 1, 2, 1, 'IMAGE'],
         ],
      )

   it('object UI-state value passes through verbatim (2025-era serialization)', () => {
      const state = { before: '/api/view?a', after: '/api/view?b' }
      const prompt = convert(compare([state]))
      expect(prompt['2']?.inputs['compare_view']).toEqual(state)
   })

   it('absent value (2026-era serialize:false) fills explicit null, never drops the required key', () => {
      const prompt = convert(compare([]))
      expect(prompt['2']?.inputs).toHaveProperty('compare_view', null)
   })

   it('array value emits wrapped {__value__} (bare 2-lists read as links server-side)', () => {
      const prompt = convert(compare([['', '']]))
      expect(prompt['2']?.inputs['compare_view']).toEqual({ __value__: ['', ''] })
   })
})

describe('config-driven consumption details', () => {
   it('control_after_generate config beats the name heuristic; forceInput makes a primitive a slot', () => {
      // mode COMBO consumes 2 (control true), seed INT consumes 1 (control FALSE
      // despite the seed name), text STRING is a slot (forceInput), steps INT 1
      const prompt = convert(
         doc(
            {
               id: 2,
               type: 'TestControlCombo',
               mode: 0,
               pos: [0, 0],
               size: [100, 100],
               inputs: [{ name: 'text', type: 'STRING', link: 15 }],
               widgets_values: ['b', 'fixed', 7, 12],
            },
            [[15, 1, 4, 2, 0, 'STRING']],
         ),
      )
      expect(prompt['2']).toEqual({
         class_type: 'TestControlCombo',
         inputs: { mode: 'b', seed: 7, steps: 12, text: ['1', 4] },
      })
   })

   it('a STRING control_after_generate mode (windows-1 SeedNode spelling) still consumes the phantom slot', () => {
      // seed INT with control_after_generate: 'fixed' consumes 2, so 'increment'
      // is the phantom and label aligns to 'hello'; a boolean-only check would
      // shift label onto the phantom
      const prompt = convert(
         doc(
            {
               id: 2,
               type: 'TestControlString',
               mode: 0,
               pos: [0, 0],
               size: [100, 100],
               widgets_values: [7, 'increment', 'hello'],
            },
            [],
         ),
      )
      expect(prompt['2']).toEqual({
         class_type: 'TestControlString',
         inputs: { seed: 7, label: 'hello' },
      })
   })

   it('widgetType names the widget for a multi-type file union (Preview3D model_file)', () => {
      const prompt = convert(
         doc(
            {
               id: 2,
               type: 'Preview3D',
               mode: 0,
               pos: [0, 0],
               size: [100, 100],
               inputs: [
                  { name: 'camera_info', type: 'LOAD3D_CAMERA', link: null },
                  { name: 'bg_image', type: 'IMAGE', link: null },
               ],
               widgets_values: ['model.glb', ''],
            },
            [],
         ),
      )
      expect(prompt['2']?.inputs['model_file']).toBe('model.glb')
   })
})
