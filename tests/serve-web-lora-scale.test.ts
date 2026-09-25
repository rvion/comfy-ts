import { describe, expect, it } from 'bun:test'
import { clampLoraScale, readLoraScales } from 'src/cli/serve/web/state/WebSt.ts'

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

describe('form and popup lora sizes', () => {
   it('are stored and restored apart', () => {
      expect(readLoraScales({ loraFormScale: 0.8, loraPopupScale: 1.6 })).toEqual({ form: 0.8, popup: 1.6 })
   })

   it('a blob from the single size era seeds both, so nothing jumps', () => {
      expect(readLoraScales({ loraScale: 1.2 })).toEqual({ form: 1.2, popup: 1.2 })
   })

   it('an empty blob draws the base size', () => {
      expect(readLoraScales({})).toEqual({ form: 1, popup: 1 })
   })
})
