import { describe, expect, it } from 'bun:test'
import { clampLoraScale } from 'src/cli/serve/web/state/WebSt.ts'

describe('lora image size', () => {
   it('stays between a little smaller and twice the base size, in steps of 0.05', () => {
      expect(clampLoraScale(1.37)).toBe(1.35)
      expect(clampLoraScale(5)).toBe(2)
      expect(clampLoraScale(0.1)).toBe(0.6)
   })

   it('a stored blob without it, or with garbage, draws the base size', () => {
      expect(clampLoraScale(undefined)).toBe(1)
      expect(clampLoraScale('big')).toBe(1)
   })
})
