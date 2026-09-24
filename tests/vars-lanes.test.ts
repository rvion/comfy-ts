import { describe, expect, it } from 'bun:test'
import { applyVarPayload } from 'src/cli/serve/applyVarPayload.ts'
import { activeLoras, v } from 'src/vars/ComfyVars.ts'

describe('prompt var in lanes', () => {
   it('the build merges the active lanes in order, each lane keeps its own negatives', () => {
      const prompt = v.prompt({
         lanes: [
            { name: 'subject', prompt: 'a cat\n- blurry', active: true },
            { name: 'wip', prompt: 'on fire', active: false },
            { name: 'style', prompt: '// note\nflat colors\n- jpeg artifacts', active: true },
         ],
      })
      expect(prompt.outValue()).toEqual({ positive: 'a cat\nflat colors', negative: 'blurry, jpeg artifacts' })
   })

   it('the TUI edits it as text with headers and gets its lanes back', () => {
      const prompt = v.prompt({ lanes: [{ name: 'subject', prompt: 'a cat', active: true }] })
      expect(prompt.toEditBuffer()).toBe('# subject\na cat')
      prompt.parse('# subject\na dog\n# style (off)\nflat')
      expect(prompt.value).toEqual({
         lanes: [
            { name: 'subject', prompt: 'a dog', active: true },
            { name: 'style', prompt: 'flat', active: false },
         ],
      })
   })

   it('a var list names the lanes, never [object Object]', () => {
      const prompt = v.prompt({
         lanes: [
            { name: 'subject', prompt: 'a cat', active: true },
            { name: 'style', prompt: 'flat', active: false },
         ],
      })
      expect(prompt.display()).toBe('2 lanes: subject, (style)')
   })

   it('a plain prompt edits as plain text: a `# ` line is just text there', () => {
      const prompt = v.prompt('a cat')
      prompt.parse('# not a lane\na cat')
      expect(prompt.value).toBe('# not a lane\na cat')
   })
})

describe('loras var in lanes', () => {
   const lanes = () =>
      v.loras(['a', 'b', 'c'], {
         lanes: [
            { name: 'style', active: true, loras: { a: 0.8 } },
            { name: 'off', active: false, loras: { b: 1 } },
            { name: 'detail', active: true, loras: { c: [0.5, 0.4] } },
         ],
      })

   it('the graph gets the active lanes in order', () => {
      expect(activeLoras(lanes().outValue()).map((l) => l.lora_name)).toEqual(['a', 'c'])
      expect(lanes().activeNames()).toEqual(['a', 'c'])
   })

   it('the TUI toggles and steps act inside the lane that holds the lora', () => {
      const loras = lanes()
      loras.adjustItem('c', 0.1)
      loras.toggleItem('a')
      expect(loras.value).toEqual({
         lanes: [
            { name: 'style', active: true, loras: { a: false } },
            { name: 'off', active: false, loras: { b: 1 } },
            { name: 'detail', active: true, loras: { c: [0.6, 0.5] } },
         ],
      })
   })
})

describe('serve accepts both shapes, refuses broken ones', () => {
   it('prompt', () => {
      const prompt = v.prompt('x')
      expect(applyVarPayload(prompt, { lanes: [{ name: 'a', prompt: 'y', active: true }] })).toBeNull()
      expect(applyVarPayload(prompt, { lanes: [{ name: 'a' }] })).toContain('expects a string or')
   })

   it('loras: every lane is checked for unknown names', () => {
      const loras = v.loras(['a', 'b'])
      expect(applyVarPayload(loras, { lanes: [{ name: 's', active: true, loras: { a: 1 } }] })).toBeNull()
      expect(applyVarPayload(loras, { lanes: [{ name: 's', active: true, loras: { zzz: 1 } }] })).toContain(
         'unknown lora',
      )
   })
})
