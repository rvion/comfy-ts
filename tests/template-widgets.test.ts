// official template widgets, real nodes from the corpus: the seed phantom on the full widget name, the socketless key as the widget signal, promoted subgraph values on slots, and required inputs that are never silently absent (architecture.md)
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseWorkflowJson } from 'src/litegraph/normalizeWorkflow.ts'
import { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import { convertLiteGraphToPrompt, WorkflowConvertError } from 'src/sdk-generator/litegraphToApiRequestPayload.ts'

const schemaOf = (path: string): ComfySchema => {
   const s = new ComfySchema({ spec: JSON.parse(readFileSync(path, 'utf-8')), embeddings: [] })
   s.update({})
   return s
}
const schema = schemaOf('tests/fixtures/object_info-template-widgets.json')
const old = schemaOf('tests/fixtures/object_info.json')

const node = (id: number, type: string, inputs: unknown[], widgets_values: unknown): Record<string, unknown> => ({
   id,
   type,
   mode: 0,
   pos: [0, 0],
   size: [100, 100],
   inputs,
   outputs: [],
   widgets_values,
})
const doc = (nodes: unknown[]) => ({ version: 0.4, links: [], nodes })

describe('official template widgets', () => {
   it('control: a 2024 KSampler seed without the key still consumes its control value', () => {
      const slot = (name: string, type: string, link: number) => ({ name, type, link })
      const ks = node(
         1,
         'KSampler',
         [
            slot('model', 'MODEL', 1),
            slot('positive', 'CONDITIONING', 2),
            slot('negative', 'CONDITIONING', 3),
            slot('latent_image', 'LATENT', 4),
         ],
         [42, 'randomize', 7, 3, 'euler', 'normal', 1],
      )
      const ckpt = node(2, 'CheckpointLoaderSimple', [], ['model.safetensors'])
      const pos = node(3, 'CLIPTextEncode', [slot('clip', 'CLIP', 5)], ['a'])
      const neg = node(4, 'CLIPTextEncode', [slot('clip', 'CLIP', 6)], ['b'])
      const lat = node(5, 'EmptyLatentImage', [], [64, 64, 1])
      const links = [
         [1, 2, 0, 1, 0, 'MODEL'],
         [2, 3, 0, 1, 1, 'CONDITIONING'],
         [3, 4, 0, 1, 2, 'CONDITIONING'],
         [4, 5, 0, 1, 3, 'LATENT'],
         [5, 2, 1, 3, 0, 'CLIP'],
         [6, 2, 1, 4, 0, 'CLIP'],
      ]
      const prompt = convertLiteGraphToPrompt(old, parseWorkflowJson({ ...doc([ks, ckpt, pos, neg, lat]), links }))
      expect(prompt['1']?.inputs).toMatchObject({ seed: 42, steps: 7, cfg: 3, sampler_name: 'euler', denoise: 1 })
   })

   it('a TextGenerate branch seed takes no control value (audio_stable_audio_3_medium node 28)', () => {
      const tg = node(
         28,
         'TextGenerate',
         [{ name: 'clip', type: 'CLIP', link: 1 }],
         ['', 256, 'on', 0.7, 64, 0.95, 0.05, 1.05, 0, 0, false, true],
      )
      const ckpt = node(1, 'CheckpointLoaderSimple', [], ['model.safetensors'])
      const links = [[1, 1, 1, 28, 0, 'CLIP']]
      const inputs = convertLiteGraphToPrompt(schema, parseWorkflowJson({ ...doc([tg, ckpt]), links }))['28']?.inputs
      expect(inputs).toMatchObject({
         'sampling_mode.seed': 0,
         'sampling_mode.presence_penalty': 0,
         thinking: false,
         use_default_template: true,
      })
   })

   it('BOUNDING_BOXES on socketless false is a widget (api_bfl_flux3_image_bboxes)', () => {
      const boxes = [
         {
            x: 192,
            y: 384,
            width: 288,
            height: 352,
            metadata: { type: 'obj', text: '', desc: 'Change it to rubber duck', palette: [] },
         },
      ]
      const cb = node(3, 'CreateBoundingBoxes', [], [896, 1152, boxes, []])
      const inputs = convertLiteGraphToPrompt(schema, parseWorkflowJson(doc([cb])))['3']?.inputs
      expect(inputs).toMatchObject({
         width: 896,
         height: 1152,
         editor_state: { __value__: boxes },
         last_incoming: { __value__: [] },
      })
   })

   it('COLORS on socketless false is a widget (api_ideogram_v4_5_image_edit)', () => {
      const ideo = node(
         4,
         'BuildJsonPromptIdeogram',
         [{ name: 'element', type: 'ARRAY', link: 1 }],
         ['', '', 'none', '', '', '', []],
      )
      const cb = node(3, 'CreateBoundingBoxes', [], [1024, 1024, [], []])
      const links = [[1, 3, 2, 4, 0, 'ARRAY']]
      const inputs = convertLiteGraphToPrompt(schema, parseWorkflowJson({ ...doc([ideo, cb]), links }))['4']?.inputs
      expect(inputs).toMatchObject({ color_palette: { __value__: [] } })
   })

   it('a promoted subgraph value fans out to a slot target (image_ernie_image width → PreviewAny.source)', () => {
      const prompt = convertLiteGraphToPrompt(schema, parseWorkflowJson(ernieLike()))
      const preview = Object.values(prompt).find((n) => n.class_type === 'PreviewAny')
      expect(preview?.inputs).toEqual({ source: 1024 })
   })

   it('a required slot left unlinked is a typed error, never a silent drop', () => {
      const pa = node(5, 'PreviewAny', [{ name: 'source', type: '*', link: null }], [null, null, null])
      let err: unknown
      try {
         convertLiteGraphToPrompt(schema, parseWorkflowJson(doc([pa])))
      } catch (e) {
         err = e
      }
      expect(err).toBeInstanceOf(WorkflowConvertError)
      expect((err as WorkflowConvertError).code).toBe('missing-required-input')
   })
})

/** the image_ernie_image shape, trimmed: subgraph input `width` (no outer link, promoted
 * through proxyWidgets) feeds EmptyFlux2LatentImage.width (a widget) AND PreviewAny.source */
function ernieLike(): unknown {
   const defId = '03921aea-a70e-44b4-bc77-f6bda10f2120'
   return {
      version: 0.4,
      links: [],
      nodes: [
         {
            id: 88,
            type: defId,
            mode: 0,
            pos: [0, 0],
            size: [100, 100],
            inputs: [],
            outputs: [],
            widgets_values: [],
            properties: { proxyWidgets: [['71', 'width']] },
         },
      ],
      definitions: {
         subgraphs: [
            {
               id: defId,
               name: 'Text to Image (ERNIE)',
               version: 1,
               state: { lastGroupId: 0, lastNodeId: 0, lastLinkId: 0, lastRerouteId: 0 },
               revision: 0,
               config: {},
               inputNode: { id: -10, bounding: [0, 0, 10, 10] },
               outputNode: { id: -20, bounding: [0, 0, 10, 10] },
               inputs: [{ id: 'w', name: 'width', type: 'INT', linkIds: [104, 113], localized_name: 'width' }],
               outputs: [],
               widgets: [],
               nodes: [
                  {
                     id: 71,
                     type: 'EmptyFlux2LatentImage',
                     mode: 0,
                     pos: [0, 0],
                     size: [100, 100],
                     inputs: [
                        { localized_name: 'width', name: 'width', type: 'INT', widget: { name: 'width' }, link: 104 },
                     ],
                     outputs: [{ name: 'LATENT', type: 'LATENT', links: [] }],
                     widgets_values: [1024, 1024, 1],
                  },
                  {
                     id: 92,
                     type: 'PreviewAny',
                     mode: 0,
                     pos: [0, 0],
                     size: [100, 100],
                     inputs: [{ localized_name: 'source', name: 'source', type: '*', link: 113 }],
                     outputs: [],
                     widgets_values: [null, null, null],
                  },
               ],
               links: [
                  { id: 104, origin_id: -10, origin_slot: 0, target_id: 71, target_slot: 0, type: 'INT' },
                  { id: 113, origin_id: -10, origin_slot: 0, target_id: 92, target_slot: 0, type: '*' },
               ],
               groups: [],
               extra: {},
            },
         ],
      },
   }
}
