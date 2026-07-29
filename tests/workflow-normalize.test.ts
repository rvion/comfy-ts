import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { type } from 'arktype'
import { LiteGraphJSON_ark } from 'src/litegraph/LiteGraphJSON.ts'
import { asLiteGraphLinkID } from 'src/litegraph/LiteGraphLinkID.ts'
import { parseWorkflowJson, WorkflowNormalizeError } from 'src/litegraph/normalizeWorkflow.ts'
import type { CanonicalWorkflow } from 'src/litegraph/CanonicalWorkflow.ts'
import { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import { convertLiteGraphToPrompt } from 'src/sdk-generator/litegraphToApiRequestPayload.ts'

const load = (name: string): unknown => JSON.parse(readFileSync(`tests/fixtures/workflows/${name}`, 'utf-8'))

// real files from the Comfy-Org template corpus (.comfy-ts/templates/), copied
// verbatim: each one exercises a serializer-era gap the wire schema must accept
const CORPUS_FIXTURES: string[] = [
   '01_get_started_text_to_image.json', // hybrid 0.4+defs, MarkdownNote, empty-widget instance
   '02_qwen_Image_edit_subgraphed.json', // io-widget era promotion, link shadows widget
   'Audio Generation (Stable Audio 3 Medium Base).json', // no root config/groups, widget w/o config, proxyWidgets
   'template_animate_diff_loops.json', // object widgets_values (VHS_*)
   '3d_triposplat_image_to_gaussian_splat.json', // group w/o font_size, nested subgraph
   'audio_ace_step_1_t2a_instrumentals.json', // group w/o color
   'templates_doc_workbox_klein_9b_image_extend.json', // inputs.link key omitted
   'api_tripo3_0_text_to_model.json', // mode 4 bypass
   'template_image_speech_to_video.json', // mode 2 mute
]

// canonical = zero optional fields; verify no undefined leaks past normalization
const assertStrict = (wf: CanonicalWorkflow): void => {
   for (const n of wf.nodes) {
      expect(n.title === null || typeof n.title === 'string').toBe(true)
      expect(['normal', 'muted', 'bypassed']).toContain(n.mode)
      expect(typeof n.isVirtualNode).toBe('boolean')
      expect(Array.isArray(n.inputs)).toBe(true)
      expect(Array.isArray(n.outputs)).toBe(true)
      expect(Array.isArray(n.widgets.positional)).toBe(true)
      expect(n.widgets.named).toBeDefined()
      expect(n.pos.length).toBe(2)
      expect(n.size.length).toBe(2)
      expect(n.properties).toBeDefined()
      for (const i of n.inputs) {
         expect(i.link === null || typeof i.link === 'number').toBe(true)
         expect(i.widgetName === null || typeof i.widgetName === 'string').toBe(true)
      }
      for (const o of n.outputs) expect(Array.isArray(o.links)).toBe(true)
   }
   for (const l of wf.links) {
      expect(typeof l.id).toBe('number')
      expect(typeof l.originId).toBe('number')
      expect(typeof l.targetId).toBe('number')
      expect(typeof l.type).toBe('string')
   }
   for (const g of wf.groups) {
      expect(typeof g.color).toBe('string')
      expect(typeof g.fontSize).toBe('number')
   }
}

describe('2026 template corpus: wire schema accepts upstream reality', () => {
   for (const name of CORPUS_FIXTURES) {
      it(`schema-passes ${name}`, () => {
         const out = LiteGraphJSON_ark(load(name))
         if (out instanceof type.errors) throw new Error(`schema reject: ${out.summary}`)
      })
      it(`normalizes ${name} to a strict canonical document`, () => {
         assertStrict(parseWorkflowJson(load(name)))
      })
   }
})

describe('normalizeWorkflow semantics', () => {
   it('rejects garbage with a typed schema-reject error', () => {
      expect(() => parseWorkflowJson({ hello: 'world' })).toThrow(WorkflowNormalizeError)
      try {
         parseWorkflowJson({ hello: 'world' })
      } catch (err) {
         expect(err).toBeInstanceOf(WorkflowNormalizeError)
         expect((err as WorkflowNormalizeError).code).toBe('schema-reject')
      }
   })

   it('maps modes: 0/1/3 execute, 2 mutes, 4 bypasses', () => {
      const wf = parseWorkflowJson(load('api_tripo3_0_text_to_model.json'))
      const byMode = new Map(wf.nodes.map((n) => [n.id, n.mode]))
      const raw = load('api_tripo3_0_text_to_model.json') as { nodes: { id: number; mode?: number }[] }
      for (const rn of raw.nodes) {
         const expected = rn.mode === 2 ? 'muted' : rn.mode === 4 ? 'bypassed' : 'normal'
         expect(byMode.get(rn.id)).toBe(expected)
      }
      expect(wf.nodes.some((n) => n.mode === 'bypassed')).toBe(true)
   })

   it('keeps muted nodes distinct (speech_to_video carries mode 2)', () => {
      const wf = parseWorkflowJson(load('template_image_speech_to_video.json'))
      expect(wf.nodes.some((n) => n.mode === 'muted')).toBe(true)
   })

   it('turns object-form widgets_values into named (VHS_*)', () => {
      const wf = parseWorkflowJson(load('template_animate_diff_loops.json'))
      const vhs = wf.nodes.find((n) => n.type === 'VHS_VideoCombine')
      if (vhs == null) throw new Error('fixture lost its VHS_VideoCombine node')
      expect(vhs.widgets.positional).toEqual([])
      expect(typeof vhs.widgets.named['frame_rate']).toBe('number')
   })

   it('fills group defaults (fontSize 24, litegraph color)', () => {
      const noFontSize = parseWorkflowJson(load('3d_triposplat_image_to_gaussian_splat.json'))
      expect(noFontSize.groups.length).toBeGreaterThan(0)
      for (const g of noFontSize.groups) expect(g.fontSize).toBe(24)
      const noColor = parseWorkflowJson(load('audio_ace_step_1_t2a_instrumentals.json'))
      expect(noColor.groups.some((g) => g.color === '#3f789e')).toBe(true)
   })

   it('normalizes omitted inputs.link to null (klein_9b)', () => {
      const wf = parseWorkflowJson(load('templates_doc_workbox_klein_9b_image_extend.json'))
      const widgetInputs = wf.nodes.flatMap((n) => n.inputs).filter((i) => i.widgetName != null)
      expect(widgetInputs.length).toBeGreaterThan(0)
      for (const i of widgetInputs.filter((i) => i.link == null)) expect(i.link).toBe(null)
   })

   it('unifies v1 object links (subgraph-era roots would take the same path)', () => {
      const doc = {
         nodes: [],
         links: [{ id: 1, origin_id: 4, origin_slot: 0, target_id: 5, target_slot: 2, type: 'MODEL' }],
         version: 1,
      }
      const wf = parseWorkflowJson(doc)
      expect(wf.links).toEqual([
         { id: asLiteGraphLinkID(1), originId: 4, originSlot: 0, targetId: 5, targetSlot: 2, type: 'MODEL' },
      ])
   })
})

describe('canonical pipeline regression ratchet (2024 fixtures)', () => {
   const spec = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
   const schema = new ComfySchema({ spec, embeddings: [] })
   schema.update({})

   // expected-prompt files were captured from the pre-canonical converter:
   // the new pipeline must reproduce them EXACTLY
   for (const name of ['ComfyUI-Workflow-2024-11-13-Simple', 'ComfyUI-Workflow-2024-11-14-Advanced']) {
      it(`reproduces the legacy prompt byte-for-byte: ${name}`, () => {
         const wf = parseWorkflowJson(JSON.parse(readFileSync(`tests/fixtures/${name}.json`, 'utf-8')))
         const prompt = convertLiteGraphToPrompt(schema, wf)
         const expected = JSON.parse(readFileSync(`tests/fixtures/${name}.expected-prompt.json`, 'utf-8'))
         expect(prompt).toEqual(expected)
      })
   }
})
