import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { type } from 'arktype'
import { LiteGraphJSON_ark } from 'src/litegraph/LiteGraphJSON.ts'
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
