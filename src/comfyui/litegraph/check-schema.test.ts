import { readFileSync } from 'fs'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'

// ------------------------------------------------------------------------------
describe('2024-11-13 json', () => {
   it('works for example ComfyUI-Workflow-2024-11-13-Simple.json', () => {
      const json = readFileSync('src/comfyui/examples/ComfyUI-Workflow-2024-11-13-Simple.json', 'utf-8')
      const parsed = JSON.parse(json)
      const parseRes = v.safeParse(LiteGraphJSON_ark, parsed)
      if (!parseRes.success) printArkResultInConsole(parseRes)
      expect(parseRes.success).toBe(true)
   })
   it('works for example ComfyUI-Workflow-2024-11-14-Advanced.json', () => {
      const json = readFileSync('src/comfyui/examples/ComfyUI-Workflow-2024-11-14-Advanced.json', 'utf-8')
      const parsed = JSON.parse(json)
      const parseRes = v.safeParse(LiteGraphJSON_ark, parsed)
      if (!parseRes.success) printArkResultInConsole(parseRes)
      expect(parseRes.success).toBe(true)
   })
})
