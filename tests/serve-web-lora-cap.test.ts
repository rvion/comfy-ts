// how many lora cards the popup draws is a MACHINE question — your collection, your box — so
// it is a setting kept in the browser, not a constant in the bundle. It is still clamped: each
// card is an image request, and a hand-typed (or restored) number must not hang the page.
import { describe, expect, it } from 'bun:test'
import { clampLoraCap, DEFAULT_LORA_CAP } from 'src/cli/serve/web/state/WebSt.ts'

describe('lora card cap', () => {
   it('keeps a real number', () => {
      expect(clampLoraCap(300)).toBe(300)
      expect(clampLoraCap(1)).toBe(1)
   })

   it('falls back to the default for anything that is not a number', () => {
      expect(clampLoraCap(undefined)).toBe(DEFAULT_LORA_CAP)
      expect(clampLoraCap('300')).toBe(DEFAULT_LORA_CAP)
      expect(clampLoraCap(Number.NaN)).toBe(DEFAULT_LORA_CAP)
   })

   it('clamps both ends: an empty box and a runaway blob are both survivable', () => {
      expect(clampLoraCap(0)).toBe(1)
      expect(clampLoraCap(-40)).toBe(1)
      expect(clampLoraCap(99_999)).toBe(2000)
   })

   it('a fractional value is floored, never left to slice()', () => {
      expect(clampLoraCap(120.9)).toBe(120)
   })
})
