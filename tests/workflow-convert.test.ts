import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseWorkflowJson, WorkflowNormalizeError } from 'src/litegraph/normalizeWorkflow.ts'
import { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import { convertLiteGraphToPrompt, WorkflowConvertError } from 'src/sdk-generator/litegraphToApiRequestPayload.ts'
import type { ComfyApiJson } from 'src/sdk-generator/comfy-api-json.ts'

const spec = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
const schema = new ComfySchema({ spec, embeddings: [] })
schema.update({})

// minimal structural view of a raw litegraph document, for in-test mutation
// (execution-semantics permutations mutate a small fixture instead of multiplying fixture files)
type RawNode = {
   id: number
   type: string
   mode?: number
   pos: number[]
   size: number[]
   inputs?: { name: string; type: string; link: number | null; widget?: { name: string } }[]
   outputs?: { name: string; type: string; links: number[] | null }[]
   widgets_values?: unknown[] | Record<string, unknown>
   properties?: Record<string, unknown>
}
type RawLinkTuple = [number, number, number, number, number, string]
type RawLinkObject = {
   id: number
   origin_id: number
   origin_slot: number
   target_id: number
   target_slot: number
   type: string
}
type RawWf = {
   nodes: RawNode[]
   links: RawLinkTuple[]
   version: number
   definitions?: { subgraphs: { id: string; nodes: RawNode[]; links: RawLinkObject[] }[] }
}

const loadRaw = (path: string): RawWf => JSON.parse(readFileSync(path, 'utf-8')) as RawWf
const simple = (): RawWf => loadRaw('tests/fixtures/ComfyUI-Workflow-2024-11-13-Simple.json')
const expectedSimple = (): ComfyApiJson =>
   JSON.parse(readFileSync('tests/fixtures/ComfyUI-Workflow-2024-11-13-Simple.expected-prompt.json', 'utf-8'))
const corpus = (name: string): unknown => JSON.parse(readFileSync(`tests/fixtures/workflows/${name}`, 'utf-8'))
const convert = (raw: unknown): ComfyApiJson => convertLiteGraphToPrompt(schema, parseWorkflowJson(raw))

const mustFind = <T>(xs: T[], pred: (x: T) => boolean, what: string): T => {
   const found = xs.find(pred)
   if (found == null) throw new Error(`test setup: ${what} not found`)
   return found
}

const expectConvertError = (raw: unknown, code: WorkflowConvertError['code']): void => {
   let err: unknown
   try {
      convert(raw)
   } catch (e) {
      err = e
   }
   expect(err).toBeInstanceOf(WorkflowConvertError)
   expect((err as WorkflowConvertError).code).toBe(code)
}

/**
 * splice a LatentUpscale between EmptyLatentImage(5) and KSampler(3):
 * link 2 [5,0 → 3,3] becomes [5,0 → 20,0] and a new link 30 [20,0 → 3,3].
 */
const withLatentUpscale = (p: { mode: number; inputType?: string; secondMode?: number }): RawWf => {
   const raw = simple()
   raw.nodes.push({
      id: 20,
      type: 'LatentUpscale',
      mode: p.mode,
      pos: [0, 0],
      size: [100, 100],
      inputs: [{ name: 'samples', type: p.inputType ?? 'LATENT', link: 2 }],
      outputs: [{ name: 'LATENT', type: 'LATENT', links: [30] }],
      widgets_values: ['nearest-exact', 512, 512, 'disabled'],
   })
   const link2 = mustFind(raw.links, (l) => l[0] === 2, 'link 2')
   link2[3] = 20
   link2[4] = 0
   raw.links.push([30, 20, 0, 3, 3, 'LATENT'])
   const ks = mustFind(raw.nodes, (n) => n.id === 3, 'KSampler')
   mustFind(ks.inputs ?? [], (i) => i.name === 'latent_image', 'latent_image input').link = 30
   if (p.secondMode != null) {
      // chain a second one: 20 → 21 → KSampler
      raw.nodes.push({
         id: 21,
         type: 'LatentUpscale',
         mode: p.secondMode,
         pos: [0, 0],
         size: [100, 100],
         inputs: [{ name: 'samples', type: 'LATENT', link: 30 }],
         outputs: [{ name: 'LATENT', type: 'LATENT', links: [31] }],
         widgets_values: ['nearest-exact', 512, 512, 'disabled'],
      })
      const link30 = mustFind(raw.links, (l) => l[0] === 30, 'link 30')
      link30[3] = 21
      link30[4] = 0
      raw.links.push([31, 21, 0, 3, 3, 'LATENT'])
      mustFind(ks.inputs ?? [], (i) => i.name === 'latent_image', 'latent_image input').link = 31
   }
   return raw
}

describe('converter: virtual-node skip', () => {
   it('skips MarkdownNote and Note instead of throwing unknown-node', () => {
      const raw = simple()
      raw.nodes.push({
         id: 98,
         type: 'MarkdownNote',
         mode: 0,
         pos: [0, 0],
         size: [100, 100],
         widgets_values: ['# doc'],
      })
      raw.nodes.push({ id: 99, type: 'Note', mode: 0, pos: [0, 0], size: [100, 100], widgets_values: ['note'] })
      expect(convert(raw)).toEqual(expectedSimple())
   })
})

describe('converter: bypass (mode 4) passthrough', () => {
   it('rewires the consumer through a bypassed node to the type-matching upstream (his silent-wrong-output repro)', () => {
      // the CORRECT graph: bypassed LatentUpscale disappears, KSampler.latent_image goes back to EmptyLatentImage
      expect(convert(withLatentUpscale({ mode: 4 }))).toEqual(expectedSimple())
   })

   it('sanity: the same graph un-bypassed routes through LatentUpscale', () => {
      const prompt = convert(withLatentUpscale({ mode: 0 }))
      const upscale = prompt['20']
      if (upscale == null) throw new Error('LatentUpscale missing from prompt')
      expect(upscale.class_type).toBe('LatentUpscale')
      expect(upscale.inputs['samples']).toEqual(['5', 0])
      expect(prompt['3']?.inputs['latent_image']).toEqual(['20', 0])
   })

   it('walks through a CHAIN of bypassed nodes', () => {
      expect(convert(withLatentUpscale({ mode: 4, secondMode: 4 }))).toEqual(expectedSimple())
   })

   it('matches * wildcard input types when walking through', () => {
      expect(convert(withLatentUpscale({ mode: 4, inputType: '*' }))).toEqual(expectedSimple())
   })

   it('dead-ends loudly when the bypassed node has no type-matching input and the consumer requires one', () => {
      const raw = simple()
      mustFind(raw.nodes, (n) => n.id === 8, 'VAEDecode').mode = 4 // no IMAGE-typed input to pass through
      expectConvertError(raw, 'missing-required-input')
   })

   it('prefers the parent input at the SAME slot index as the resolved output (frontend _getBypassSlotIndex parity)', () => {
      // bypassed 2-in/2-out mixer between both CLIPTextEncode nodes and KSampler:
      // positive rides slot 0, negative rides slot 1 — a first-type-match scan
      // would send BOTH conditionings back to node 6
      const raw = simple()
      raw.nodes.push({
         id: 25,
         type: 'FakeCondMixer',
         mode: 4,
         pos: [0, 0],
         size: [100, 100],
         inputs: [
            { name: 'cond_a', type: 'CONDITIONING', link: 4 },
            { name: 'cond_b', type: 'CONDITIONING', link: 6 },
         ],
         outputs: [
            { name: 'out_a', type: 'CONDITIONING', links: [62] },
            { name: 'out_b', type: 'CONDITIONING', links: [63] },
         ],
      })
      const link4 = mustFind(raw.links, (l) => l[0] === 4, 'link 4')
      link4[3] = 25
      link4[4] = 0
      const link6 = mustFind(raw.links, (l) => l[0] === 6, 'link 6')
      link6[3] = 25
      link6[4] = 1
      raw.links.push([62, 25, 0, 3, 1, 'CONDITIONING'])
      raw.links.push([63, 25, 1, 3, 2, 'CONDITIONING'])
      const ks = mustFind(raw.nodes, (n) => n.id === 3, 'KSampler')
      mustFind(ks.inputs ?? [], (i) => i.name === 'positive', 'positive input').link = 62
      mustFind(ks.inputs ?? [], (i) => i.name === 'negative', 'negative input').link = 63
      expect(convert(raw)).toEqual(expectedSimple())
   })

   it('matches on the CONSUMER input type, not the link type, through a *-typed output (frontend parity)', () => {
      // bypassed router: CONDITIONING at slot 0, LATENT at slot 1, *-typed
      // output at slot 0 — link-type matching (* matches anything) would pass
      // the consumer LATENT through to the CONDITIONING parent
      const raw = simple()
      raw.nodes.push({
         id: 26,
         type: 'FakeRouter',
         mode: 4,
         pos: [0, 0],
         size: [100, 100],
         inputs: [
            { name: 'any_a', type: 'CONDITIONING', link: 70 },
            { name: 'any_b', type: 'LATENT', link: 2 },
         ],
         outputs: [{ name: 'out', type: '*', links: [71] }],
      })
      raw.links.push([70, 6, 0, 26, 0, 'CONDITIONING'])
      const clip = mustFind(raw.nodes, (n) => n.id === 6, 'CLIPTextEncode')
      clip.outputs?.[0]?.links?.push(70)
      const link2 = mustFind(raw.links, (l) => l[0] === 2, 'link 2')
      link2[3] = 26
      link2[4] = 1
      raw.links.push([71, 26, 0, 3, 3, '*'])
      const ks = mustFind(raw.nodes, (n) => n.id === 3, 'KSampler')
      mustFind(ks.inputs ?? [], (i) => i.name === 'latent_image', 'latent_image input').link = 71
      expect(convert(raw)).toEqual(expectedSimple())
   })
})

describe('converter: linked trailing widget (positional array shorter than schema)', () => {
   /** seed becomes a linked input while widgets_values goes EMPTY: every widget sits past the array end */
   const withLinkedSeed = (p: { sourceMode?: number }): RawWf => {
      const raw = simple()
      raw.nodes.push({
         id: 41,
         type: 'EmptyLatentImage',
         mode: p.sourceMode ?? 0,
         pos: [0, 0],
         size: [100, 100],
         outputs: [{ name: 'LATENT', type: 'LATENT', links: [51] }],
         widgets_values: [512, 512, 1],
      })
      const ks = mustFind(raw.nodes, (n) => n.id === 3, 'KSampler')
      ks.inputs = [...(ks.inputs ?? []), { name: 'seed', type: 'INT', link: 51, widget: { name: 'seed' } }]
      ks.widgets_values = []
      raw.links.push([51, 41, 0, 3, 4, 'INT'])
      return raw
   }

   it('a LIVE link on the trailing widget wins: no throw, no spurious fill', () => {
      expect(convert(withLinkedSeed({}))['3']?.inputs['seed']).toEqual(['41', 0])
   })

   it('a DEAD link (muted parent) falls back to the schema default, never an error', () => {
      expect(convert(withLinkedSeed({ sourceMode: 2 }))['3']?.inputs['seed']).toBe(0)
   })
})

describe('converter: muted parents resolve unconnected', () => {
   it('does not emit a dangling link to a muted parent; required consumer throws typed', () => {
      const raw = simple()
      mustFind(raw.nodes, (n) => n.id === 5, 'EmptyLatentImage').mode = 2
      expectConvertError(raw, 'missing-required-input')
   })
})

describe('converter: named widget values', () => {
   it('resolves object-form widgets_values by input name (no offset arithmetic)', () => {
      const doc: RawWf = {
         version: 0.4,
         nodes: [
            {
               id: 1,
               type: 'EmptyLatentImage',
               mode: 0,
               pos: [0, 0],
               size: [100, 100],
               widgets_values: { width: 640, height: 480, batch_size: 2 },
            },
         ],
         links: [],
      }
      expect(convert(doc)['1']).toEqual({
         class_type: 'EmptyLatentImage',
         inputs: { width: 640, height: 480, batch_size: 2 },
      })
   })

   it('fills the schema default for an absent named value (what the frontend does), never throws', () => {
      const doc: RawWf = {
         version: 0.4,
         nodes: [
            {
               id: 1,
               type: 'EmptyLatentImage',
               mode: 0,
               pos: [0, 0],
               size: [100, 100],
               widgets_values: { width: 640 },
            },
         ],
         links: [],
      }
      expect(convert(doc)['1']).toEqual({
         class_type: 'EmptyLatentImage',
         inputs: { width: 640, height: 512, batch_size: 1 },
      })
   })

   it('lets a named override shadow a positional slot while the offset still advances (subgraph promotion case)', () => {
      const wf = parseWorkflowJson(simple())
      const ks = mustFind(wf.nodes, (n) => n.type === 'KSampler', 'KSampler')
      ks.widgets.named['seed'] = 42
      const prompt = convertLiteGraphToPrompt(schema, wf)
      expect(prompt['3']?.inputs['seed']).toBe(42) // named wins
      expect(prompt['3']?.inputs['steps']).toBe(20) // positional walk unshifted past the shadowed seed(+phantom) slots
   })
})

describe('converter: PrimitiveNode inline', () => {
   /** wire a PrimitiveNode into KSampler.seed (widget-backed input, new slot 4) */
   const withPrimitiveSeed = (p: { value?: unknown }): RawWf => {
      const raw = simple()
      raw.nodes.push({
         id: 40,
         type: 'PrimitiveNode',
         mode: 0,
         pos: [0, 0],
         size: [100, 100],
         outputs: [{ name: 'connect to widget input', type: '*', links: [50] }],
         ...(p.value !== undefined ? { widgets_values: [p.value] } : {}),
      })
      const ks = mustFind(raw.nodes, (n) => n.id === 3, 'KSampler')
      ks.inputs = [...(ks.inputs ?? []), { name: 'seed', type: 'INT', link: 50, widget: { name: 'seed' } }]
      raw.links.push([50, 40, 0, 3, 4, 'INT'])
      return raw
   }

   it('inlines a valued PrimitiveNode over the consumer serialized widget value', () => {
      expect(convert(withPrimitiveSeed({ value: 999 }))['3']?.inputs['seed']).toBe(999)
   })

   it('a VALUELESS PrimitiveNode (corpus reality) leaves the consumer on its own widget value', () => {
      expect(convert(withPrimitiveSeed({}))).toEqual(expectedSimple())
   })

   it('a NON-SCALAR primitive value throws typed invalid-widget-value instead of casting garbage into the prompt', () => {
      expectConvertError(withPrimitiveSeed({ value: { evil: true } }), 'invalid-widget-value')
   })
})

describe('subgraph expansion', () => {
   const GET_STARTED_DEF = '27a9a311-dfa9-41fa-b08b-6f5b50553553'

   it('inlines the get_started definition: no instance remains, full prompt emitted', () => {
      const wf = parseWorkflowJson(corpus('01_get_started_text_to_image.json'))
      expect(wf.nodes.some((n) => n.type === GET_STARTED_DEF)).toBe(false)
      const prompt = convertLiteGraphToPrompt(schema, wf)
      const types = Object.values(prompt)
         .map((n) => n.class_type)
         .sort()
      expect(types).toEqual([
         'CLIPLoader',
         'CLIPTextEncode',
         'ConditioningZeroOut',
         'EmptySD3LatentImage',
         'KSampler',
         'ModelSamplingAuraFlow',
         'SaveImage',
         'UNETLoader',
         'VAEDecode',
         'VAELoader',
      ])
      // output boundary: SaveImage.images wired to the remapped inner VAEDecode
      const vaeEntry = mustFind(Object.entries(prompt), ([, n]) => n.class_type === 'VAEDecode', 'VAEDecode')
      const save = mustFind(Object.values(prompt), (n) => n.class_type === 'SaveImage', 'SaveImage')
      expect(save.inputs['images']).toEqual([vaeEntry[0], 0])
      // empty instance widgets: inner nodes keep their serialized defaults
      const cte = mustFind(Object.values(prompt), (n) => n.class_type === 'CLIPTextEncode', 'CLIPTextEncode')
      expect(String(cte.inputs['text']).startsWith('Giant blue and purple big billboard')).toBe(true)
   })

   it('promotes proxyWidgets-era instance values into inner nodes named overrides', () => {
      const raw = loadRaw('tests/fixtures/workflows/01_get_started_text_to_image.json')
      // pairs: [90,text] [91,width] [91,height] [89,unet_name] [85,clip_name] [86,vae_name] [92,seed] [92,control_after_generate]
      mustFind(raw.nodes, (n) => n.id === 104, 'instance').widgets_values = [
         'promoted prompt',
         640,
         480,
         'u.sft',
         'c.sft',
         'v.sft',
         42,
         'fixed',
      ]
      const prompt = convertLiteGraphToPrompt(schema, parseWorkflowJson(raw))
      const cte = mustFind(Object.values(prompt), (n) => n.class_type === 'CLIPTextEncode', 'CLIPTextEncode')
      expect(cte.inputs['text']).toBe('promoted prompt')
      const latent = mustFind(
         Object.values(prompt),
         (n) => n.class_type === 'EmptySD3LatentImage',
         'EmptySD3LatentImage',
      )
      expect(latent.inputs['width']).toBe(640)
      expect(latent.inputs['height']).toBe(480)
      const ks = mustFind(Object.values(prompt), (n) => n.class_type === 'KSampler', 'KSampler')
      expect(ks.inputs['seed']).toBe(42)
      expect(ks.inputs['steps']).toBe(4) // positional walk intact after the named seed override
      expect(ks.inputs['control_after_generate']).toBeUndefined() // phantom never reaches the prompt
   })

   it('promotes io-widget-era instance values BY DEF-INPUT ORDER and lets outer links win (02_qwen)', () => {
      const wf = parseWorkflowJson(corpus('02_qwen_Image_edit_subgraphed.json'))
      expect(wf.nodes.some((n) => n.type === '6b4b0518-e42a-4e8b-a377-f0da6dacfcac')).toBe(false)
      const ks = mustFind(wf.nodes, (n) => n.type === 'KSampler', 'KSampler')
      expect(ks.widgets.named['seed']).toBe(392667428726572)
      const tes = wf.nodes.filter((n) => n.type === 'TextEncodeQwenImageEditPlus')
      expect(tes.length).toBe(2)
      expect(tes.some((n) => String(n.widgets.named['prompt']).startsWith('Change the style'))).toBe(true)
      expect(tes.some((n) => n.widgets.named['prompt'] === '')).toBe(true)
      // width/height have OUTER links into the def slots: the named override exists but the link survives
      const latent = mustFind(wf.nodes, (n) => n.type === 'EmptySD3LatentImage', 'EmptySD3LatentImage')
      const width = mustFind(latent.inputs, (i) => i.name === 'width', 'width input')
      expect(width.link).not.toBe(null)
      expect(wf.links.some((l) => l.id === width.link)).toBe(true)
      // this 2026 workflow names nodes the 2024 object_info lacks: the metric split relies on the TYPED code
      let err: unknown
      try {
         convertLiteGraphToPrompt(schema, wf)
      } catch (e) {
         err = e
      }
      expect(err).toBeInstanceOf(WorkflowConvertError)
      expect((err as WorkflowConvertError).code).toBe('unknown-node')
   })

   it('expands NESTED definitions (def inside def, triposplat)', () => {
      const raw = loadRaw('tests/fixtures/workflows/3d_triposplat_image_to_gaussian_splat.json')
      const defIds = new Set(
         (
            JSON.parse(JSON.stringify(raw)) as { definitions: { subgraphs: { id: string }[] } }
         ).definitions.subgraphs.map((d) => d.id),
      )
      const wf = parseWorkflowJson(corpus('3d_triposplat_image_to_gaussian_splat.json'))
      expect(wf.nodes.some((n) => defIds.has(n.type))).toBe(false)
      // nodes of the INNER def (Remove Background) got spliced in through two levels
      expect(wf.nodes.some((n) => n.type === 'JoinImageWithAlpha')).toBe(true)
   })

   it('drops a MUTED instance and nulls its consumers', () => {
      const raw = loadRaw('tests/fixtures/workflows/01_get_started_text_to_image.json')
      mustFind(raw.nodes, (n) => n.id === 104, 'instance').mode = 2
      const wf = parseWorkflowJson(raw)
      expect(wf.nodes.some((n) => n.type === GET_STARTED_DEF)).toBe(false)
      expect(wf.nodes.map((n) => n.type).sort()).toEqual(['MarkdownNote', 'SaveImage'])
      const save = mustFind(wf.nodes, (n) => n.type === 'SaveImage', 'SaveImage')
      expect(mustFind(save.inputs, (i) => i.name === 'images', 'images input').link).toBe(null)
   })

   it('leaves a BYPASSED instance for the converter passthrough', () => {
      const raw = loadRaw('tests/fixtures/workflows/01_get_started_text_to_image.json')
      mustFind(raw.nodes, (n) => n.id === 104, 'instance').mode = 4
      const wf = parseWorkflowJson(raw)
      expect(wf.nodes.some((n) => n.type === GET_STARTED_DEF)).toBe(true)
      // instance has no IMAGE-typed input: SaveImage.images dead-ends, required → typed error (never unknown-node)
      let err: unknown
      try {
         convertLiteGraphToPrompt(schema, wf)
      } catch (e) {
         err = e
      }
      expect(err).toBeInstanceOf(WorkflowConvertError)
      expect((err as WorkflowConvertError).code).toBe('missing-required-input')
   })

   it('routes proxyWidgets pairs with inner id -1 through the def io slot (blueprint era, his corpus)', () => {
      // 31 corpus blueprints promote io widgets as [["-1", <def input name>], …]:
      // -1 names the subgraph node itself, the value lands on the io slot's inner targets
      const raw = loadRaw('tests/fixtures/workflows/01_get_started_text_to_image.json')
      const inst = mustFind(raw.nodes, (n) => n.id === 104, 'instance')
      inst.widgets_values = ['io prompt']
      inst.properties = { ...inst.properties, proxyWidgets: [['-1', 'text']] }
      const prompt = convertLiteGraphToPrompt(schema, parseWorkflowJson(raw))
      const cte = mustFind(Object.values(prompt), (n) => n.class_type === 'CLIPTextEncode', 'CLIPTextEncode')
      expect(cte.inputs['text']).toBe('io prompt')
   })

   it('drops stale definition links referencing deleted inner nodes (corpus reality: utility_video_upscale)', () => {
      const raw = loadRaw('tests/fixtures/workflows/01_get_started_text_to_image.json')
      const def = mustFind(raw.definitions?.subgraphs ?? [], (d) => d.id === GET_STARTED_DEF, 'definition')
      // stale producer FIRST so a naive first-wins walk would pick the dead node
      def.links.unshift({ id: 900, origin_id: 679, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' })
      def.links.push({ id: 901, origin_id: 90, origin_slot: 0, target_id: 679, target_slot: 0, type: 'CONDITIONING' })
      const pristine = convertLiteGraphToPrompt(schema, parseWorkflowJson(corpus('01_get_started_text_to_image.json')))
      expect(convertLiteGraphToPrompt(schema, parseWorkflowJson(raw))).toEqual(pristine)
   })

   it('throws typed subgraph-io-mismatch when an instance input name matches NO def input (renamed slot)', () => {
      const raw = loadRaw('tests/fixtures/workflows/01_get_started_text_to_image.json')
      const inst = mustFind(raw.nodes, (n) => n.id === 104, 'instance')
      mustFind(inst.inputs ?? [], (i) => i.name === 'text', 'text input').name = 'renamed_text'
      let err: unknown
      try {
         parseWorkflowJson(raw)
      } catch (e) {
         err = e
      }
      expect(err).toBeInstanceOf(WorkflowNormalizeError)
      expect((err as WorkflowNormalizeError).code).toBe('subgraph-io-mismatch')
   })

   it('named overrides on a NESTED subgraph instance survive the next expansion pass (hand-built)', () => {
      const boundary = {
         inputNode: { id: -10, bounding: [0, 0, 0, 0] },
         outputNode: { id: -20, bounding: [0, 0, 0, 0] },
      }
      const defB = {
         id: 'bbbbbbbb-0000-4000-8000-000000000000',
         name: 'inner',
         version: 1,
         nodes: [
            {
               id: 10,
               type: 'CLIPTextEncode',
               mode: 0,
               pos: [0, 0],
               size: [100, 100],
               inputs: [{ name: 'text', type: 'STRING', link: 100, widget: { name: 'text' } }],
               outputs: [],
               widgets_values: ['inner default'],
            },
         ],
         links: [{ id: 100, origin_id: -10, origin_slot: 0, target_id: 10, target_slot: 0, type: 'STRING' }],
         ...boundary,
         inputs: [{ id: 'io-b-text', name: 'text', type: 'STRING' }],
         outputs: [],
         widgets: [],
      }
      const defA = {
         id: 'aaaaaaaa-0000-4000-8000-000000000000',
         name: 'outer',
         version: 1,
         nodes: [
            {
               id: 20,
               type: defB.id,
               mode: 0,
               pos: [0, 0],
               size: [100, 100],
               inputs: [{ name: 'text', type: 'STRING', link: 200, widget: { name: 'text' } }],
               outputs: [],
               widgets_values: [],
            },
         ],
         links: [{ id: 200, origin_id: -10, origin_slot: 0, target_id: 20, target_slot: 0, type: 'STRING' }],
         ...boundary,
         inputs: [{ id: 'io-a-text', name: 'text', type: 'STRING' }],
         outputs: [],
         widgets: [],
      }
      const doc = {
         version: 0.4,
         nodes: [
            // io-widget era: the root instance's positional value promotes into
            // the NESTED instance as a named override; pass 2 must forward it
            { id: 1, type: defA.id, mode: 0, pos: [0, 0], size: [100, 100], widgets_values: ['OUTER OVERRIDE'] },
         ],
         links: [],
         definitions: { subgraphs: [defA, defB] },
      }
      const wf = parseWorkflowJson(doc)
      const cte = mustFind(wf.nodes, (n) => n.type === 'CLIPTextEncode', 'inner CLIPTextEncode')
      expect(cte.widgets.named['text']).toBe('OUTER OVERRIDE')
   })

   it('throws a typed subgraph-cycle error on self-referencing definitions', () => {
      const defId = 'aaaaaaaa-0000-4000-8000-000000000000'
      const instance = (id: number): RawNode => ({
         id,
         type: defId,
         mode: 0,
         pos: [0, 0],
         size: [100, 100],
         widgets_values: [],
      })
      const doc = {
         version: 0.4,
         nodes: [instance(1)],
         links: [],
         definitions: {
            subgraphs: [
               {
                  id: defId,
                  name: 'ouroboros',
                  version: 1,
                  nodes: [instance(10)],
                  links: [],
                  inputNode: { id: -10, bounding: [0, 0, 0, 0] },
                  outputNode: { id: -20, bounding: [0, 0, 0, 0] },
                  inputs: [],
                  outputs: [],
                  widgets: [],
               },
            ],
         },
      }
      let err: unknown
      try {
         parseWorkflowJson(doc)
      } catch (e) {
         err = e
      }
      expect(err).toBeInstanceOf(WorkflowNormalizeError)
      expect((err as WorkflowNormalizeError).code).toBe('subgraph-cycle')
   })
})
