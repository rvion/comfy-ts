// the stylesheet is ONE template literal, so a stray backtick or an unbalanced brace silently
// changes what every rule below it means. These are the invariants the lora card depends on.
import { describe, expect, it } from 'bun:test'
import { STYLES } from 'src/cli/serve/web/styles.ts'

function ruleBody(selector: string): string {
   const at = STYLES.indexOf(selector)
   expect(at).toBeGreaterThan(-1)
   const open = STYLES.indexOf('{', at)
   return STYLES.slice(open + 1, STYLES.indexOf('}', open))
}

describe('web stylesheet', () => {
   it('has balanced braces', () => {
      const opens = STYLES.split('{').length - 1
      expect(opens).toBe(STYLES.split('}').length - 1)
   })

   it('the lora ✕ is positioned against the PICTURE, and out of flow', () => {
      // it sat in flow above the thumb whenever its containing block was not what we assumed
      expect(ruleBody('.chip-media {')).toContain('position: relative')
      const remove = ruleBody('.chip-media .chip-remove,')
      expect(remove).toContain('position: absolute')
      expect(remove).toContain('width: auto') // a stretch parent pulls it across the card otherwise
   })

   it('the ✕ rule outranks the generic .lora-chip button rule', () => {
      // `.lora-chip button` is 0-1-1: a bare `.chip-remove` (0-1-0) LOSES to it, and the ✕
      // silently drops the padding and backdrop that make it readable over an image
      const generic = STYLES.indexOf('.lora-chip button {')
      const scoped = STYLES.indexOf('.chip-media .chip-remove,')
      expect(generic).toBeGreaterThan(-1)
      expect(scoped).toBeGreaterThan(generic)
      expect(STYLES).not.toMatch(/\n\.chip-remove \{/) // never the unscoped, losing form
   })
})
