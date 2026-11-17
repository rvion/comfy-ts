// why we think it is actually a bug, and not just meaning spec should change: a workflow json is user input, and the importer promises a converted prompt or a typed import error; a long chain threw RangeError (stack overflow) and a subgraph holding two instances of itself never returned (the old code hangs this file's cycle test, red proof: the reviewer's subgraph-doubling-hang.ts killed by a 15 s alarm, exit 142)
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseWorkflowJson, WorkflowNormalizeError } from 'src/litegraph/normalizeWorkflow.ts'
import { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import { convertLiteGraphToPrompt, WorkflowConvertError } from 'src/sdk-generator/litegraphToApiRequestPayload.ts'

const schema = new ComfySchema({
   spec: JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8')),
   embeddings: [],
})
schema.update({})

/** node 1 has its required image unlinked, 2..n chain behind it, one PreviewImage at the end */
const chain = (n: number): unknown => {
   const nodes: Record<string, unknown>[] = []
   const links: unknown[] = []
   for (let i = 1; i <= n; i++)
      nodes.push({
         id: i,
         type: 'ImageInvert',
         mode: 0,
         pos: [0, 0],
         size: [1, 1],
         inputs: [{ name: 'image', type: 'IMAGE', link: i > 1 ? i - 1 : null }],
      })
   for (let i = 1; i < n; i++) links.push([i, i, 0, i + 1, 0, 'IMAGE'])
   links.push([n, n, 0, n + 1, 0, 'IMAGE'])
   nodes.push({
      id: n + 1,
      type: 'PreviewImage',
      mode: 0,
      pos: [0, 0],
      size: [1, 1],
      inputs: [{ name: 'images', type: 'IMAGE', link: n }],
   })
   return { version: 0.4, nodes, links }
}

const def = (id: string, name: string, inner: string[]): Record<string, unknown> => ({
   id,
   name,
   version: 1,
   state: {},
   revision: 0,
   config: {},
   inputNode: { id: -10, bounding: [0, 0, 1, 1] },
   outputNode: { id: -20, bounding: [0, 0, 1, 1] },
   inputs: [],
   outputs: [],
   widgets: [],
   nodes: inner.map((type, ix) => ({ id: ix + 1, type, mode: 0, pos: [0, 0], size: [1, 1] })),
   links: [],
})
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const doc = (defs: Record<string, unknown>[], root: string): unknown => ({
   version: 0.4,
   nodes: [{ id: 1, type: root, mode: 0, pos: [0, 0], size: [1, 1] }],
   links: [],
   definitions: { subgraphs: defs },
})
const normalizeError = (raw: unknown): WorkflowNormalizeError => {
   try {
      parseWorkflowJson(raw)
   } catch (e) {
      if (e instanceof WorkflowNormalizeError) return e
      throw e
   }
   throw new Error('expected a WorkflowNormalizeError')
}

describe('repro: hostile workflow files', () => {
   it('a 50,000 node chain ends in the typed error, not a stack overflow', () => {
      let err: unknown
      try {
         convertLiteGraphToPrompt(schema, parseWorkflowJson(chain(50_000)))
      } catch (e) {
         err = e
      }
      expect(err).toBeInstanceOf(WorkflowConvertError)
   })

   it('a subgraph holding two instances of itself is a typed cycle naming it', () => {
      const e = normalizeError(doc([def(A, 'bomb', [A, A])], A))
      expect(e.code).toBe('subgraph-cycle')
      expect(e.message).toContain('bomb')
   })

   it('a cycle through another subgraph names both', () => {
      const e = normalizeError(doc([def(A, 'alpha', [B]), def(B, 'beta', [A])], A))
      expect(e.code).toBe('subgraph-cycle')
      expect(e.message).toContain('alpha')
      expect(e.message).toContain('beta')
   })

   it('nesting without a cycle that would expand past the cap is a typed error, counted not expanded', () => {
      const ids = Array.from({ length: 20 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
      const defs = ids.map((id, i) =>
         def(id, `level${i}`, i + 1 < ids.length ? [ids[i + 1] ?? '', ids[i + 1] ?? ''] : ['Note']),
      )
      const e = normalizeError(doc(defs, ids[0] ?? ''))
      expect(e.code).toBe('subgraph-too-large')
   })

   it('control: a nested subgraph without a cycle expands', () => {
      const wf = parseWorkflowJson(doc([def(A, 'outer', [B, B]), def(B, 'inner', ['Note', 'Note'])], A))
      expect(wf.nodes.map((n) => n.type)).toEqual(['Note', 'Note', 'Note', 'Note'])
   })
})
