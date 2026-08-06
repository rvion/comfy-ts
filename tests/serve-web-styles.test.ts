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

   it('carries no backtick', () => {
      // the whole sheet is ONE template literal: a backtick in a comment ends it early and
      // turns the rest of the file into code, which is a build error far from the cause
      expect(STYLES).not.toContain('`')
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

   it('the preset menu sits above its own click-catching backdrop', () => {
      // the backdrop is what closes the menu on an outside click; one z-index below the menu
      // and it would swallow the click on the preset you were aiming at
      const backdrop = ruleBody('.preset-backdrop {')
      const menu = ruleBody('.preset-menu {')
      expect(backdrop).toContain('position: fixed')
      const zOf = (body: string): number => Number(/z-index: (\d+)/.exec(body)?.[1] ?? 0)
      expect(zOf(menu)).toBeGreaterThan(zOf(backdrop))
      expect(menu).toContain('position: absolute') // anchored to .preset-box, which is relative
      expect(ruleBody('.preset-box {')).toContain('position: relative')
   })
})
