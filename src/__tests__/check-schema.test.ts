import { type } from 'arktype'
import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { LiteGraphJSON_ark } from '../litegraph/LiteGraphJSON'
import { printArkResultInConsole } from '../utils/printArkResultInConsole'

// ------------------------------------------------------------------------------
describe('2024-11-13 json', () => {
   it('works for example ComfyUI-Workflow-2024-11-13-Simple.json', () => {
      const string = readFileSync('src/comfyui/examples/ComfyUI-Workflow-2024-11-13-Simple.json', 'utf-8')
      const json = JSON.parse(string)
      const workflow = LiteGraphJSON_ark(json)
      if (workflow instanceof type.errors) printArkResultInConsole(workflow)
      expect(workflow).not.toBeInstanceOf(type.errors)
   })

   it('works for example ComfyUI-Workflow-2024-11-14-Advanced.json', () => {
      const string = readFileSync('src/comfyui/examples/ComfyUI-Workflow-2024-11-14-Advanced.json', 'utf-8')
      const json = JSON.parse(string)
      const workflow = LiteGraphJSON_ark(json)
      if (workflow instanceof type.errors) printArkResultInConsole(workflow)
      expect(workflow).not.toBeInstanceOf(type.errors)
   })
})
