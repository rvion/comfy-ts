import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { parseWorkflowJson } from 'src/litegraph/normalizeWorkflow.ts'
import { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import { convertLiteGraphToPrompt, WorkflowConvertError } from 'src/sdk-generator/litegraphToApiRequestPayload.ts'

// compat RATCHET: template compatibility only moves forward. Every committed
// corpus fixture must survive the FULL import chain (ark schema → normalize →
// convert) against the committed 2024 object_info. `unknown-node` is the ONE
// acceptable convert outcome (the 2024 fixture predates 2026 node
// inventories — host inventory, not a defect); anything else is a regression.
// New fixtures auto-enroll via readdirSync.

const spec = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
const schema = new ComfySchema({ spec, embeddings: [] })
schema.update({})

const fixtures = readdirSync('tests/fixtures/workflows')
   .filter((f) => f.endsWith('.json'))
   .sort()

describe('template compat ratchet (schema + normalize + structural convert)', () => {
   it('the fixture corpus is still enrolled', () => {
      expect(fixtures.length).toBeGreaterThanOrEqual(10)
   })

   for (const name of fixtures) {
      it(`structurally converts ${name}`, () => {
         // parseWorkflowJson throwing = schema/normalize regression, test fails loud
         const wf = parseWorkflowJson(JSON.parse(readFileSync(`tests/fixtures/workflows/${name}`, 'utf-8')))
         try {
            const prompt = convertLiteGraphToPrompt(schema, wf)
            expect(Object.keys(prompt).length).toBeGreaterThan(0)
         } catch (err) {
            if (err instanceof WorkflowConvertError && err.code === 'unknown-node') return
            throw err
         }
      })
   }
})
