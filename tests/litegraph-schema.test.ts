import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { type } from 'arktype'
import { LiteGraphJSON_ark } from 'src/litegraph/LiteGraphJSON.ts'
import { LiteGraphNodeInput_ark } from 'src/litegraph/LiteGraphNodeInput.ts'
import { LiteGraphNodeOutput_ark } from 'src/litegraph/LiteGraphNodeOutput.ts'
import { printArkResultInConsole } from 'src/utils/printArkResultInConsole.ts'
import { parseWorkflowJson } from 'src/litegraph/normalizeWorkflow.ts'
import { ComfySchema } from 'src/sdk-generator/ComfySchema.ts'
import { convertLiteGraphToPrompt } from 'src/sdk-generator/litegraphToApiRequestPayload.ts'

const validate = (path: string): unknown => {
   const json = JSON.parse(readFileSync(path, 'utf-8'))
   const workflow = LiteGraphJSON_ark(json)
   if (workflow instanceof type.errors) printArkResultInConsole(workflow)
   return workflow
}

describe('LiteGraphJSON arktype schema', () => {
   it('accepts the simple example workflow', () => {
      expect(validate('tests/fixtures/ComfyUI-Workflow-2024-11-13-Simple.json')).not.toBeInstanceOf(type.errors)
   })

   it('accepts the advanced example workflow', () => {
      expect(validate('tests/fixtures/ComfyUI-Workflow-2024-11-14-Advanced.json')).not.toBeInstanceOf(type.errors)
   })

   // why we think it is actually a bug, and not just meaning spec should change: the frontend types last_node_id as a NodeId (number | string), and the official ComfyUI blueprints ship it as a string ("298"), so a file the frontend opens fails our tolerant schema
   it('accepts last_node_id as a string, the way the official blueprints serialize it', () => {
      const root = { nodes: [], links: [], version: 0.4, last_link_id: 0 }
      expect(LiteGraphJSON_ark({ ...root, last_node_id: 298 })).not.toBeInstanceOf(type.errors)
      expect(LiteGraphJSON_ark({ ...root, last_node_id: '298' })).not.toBeInstanceOf(type.errors)
   })

   // why we think it is actually a bug, and not just meaning spec should change: the official fibo2 edit templates write null for every unset slot field (output slot_index, input label) and the frontend opens them, so our tolerant schema must read null as absent
   it('accepts null slot fields, the way the official fibo2 templates serialize them', () => {
      const output = { name: 'MODEL', type: 'MODEL', links: [1] }
      expect(LiteGraphNodeOutput_ark({ ...output, slot_index: 0 })).not.toBeInstanceOf(type.errors)
      expect(LiteGraphNodeOutput_ark({ ...output, slot_index: null })).not.toBeInstanceOf(type.errors)
      const input = { name: 'model', type: 'MODEL', link: 1 }
      expect(LiteGraphNodeInput_ark({ ...input, label: 'model' })).not.toBeInstanceOf(type.errors)
      expect(LiteGraphNodeInput_ark({ ...input, label: null })).not.toBeInstanceOf(type.errors)
   })
})

describe('litegraph -> api conversion (real saved workflows)', () => {
   const spec = JSON.parse(readFileSync('tests/fixtures/object_info.json', 'utf-8'))
   const schema = new ComfySchema({ spec, embeddings: [] })
   schema.update({})

   it('converts the simple workflow', () => {
      const wf = parseWorkflowJson(
         JSON.parse(readFileSync('tests/fixtures/ComfyUI-Workflow-2024-11-13-Simple.json', 'utf-8')),
      )
      const prompt = convertLiteGraphToPrompt(schema, wf)
      expect(Object.keys(prompt).length).toBe(8)
   })

   it('converts the advanced 32-node workflow', () => {
      const wf = parseWorkflowJson(
         JSON.parse(readFileSync('tests/fixtures/ComfyUI-Workflow-2024-11-14-Advanced.json', 'utf-8')),
      )
      const prompt = convertLiteGraphToPrompt(schema, wf)
      expect(Object.keys(prompt).length).toBe(32)
   })
})
