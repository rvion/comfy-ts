// the lora card has NO grip. The whole card is the drag source (mousedown disarms it when
// the press lands on a control), so a permanent handle is chrome that buys nothing.
// this is a guard, not a style opinion: the grip came back three times.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const card = readFileSync('src/cli/serve/web/components/controls/LorasControl.tsx', 'utf8')
const css = readFileSync('src/cli/serve/web/styles.ts', 'utf8')

describe('lora card chrome', () => {
   it('renders no grip, under any name', () => {
      // guarding the class NAME alone let a grip come back as .chip-handle: what must not
      // exist is a permanent element between the card edge and its picture
      expect(card).not.toContain('chip-grip')
      expect(card).not.toContain('name="grip"')
      expect(card).not.toContain("name='grip'")
      expect(css).not.toContain('chip-grip')
      expect(card.slice(card.indexOf('lora-chip card'), card.indexOf('chip-media'))).not.toMatch(
         /className="chip-(grip|handle|drag)/,
      )
   })

   it('still drags: the card itself is draggable, and disarms on a control', () => {
      expect(card).toMatch(/\n\s+draggable\n/) // the attribute, not just a handler that implies it
      expect(card).toContain('onDragStart')
      expect(card).toContain('onMouseDown')
      // the disarm is what keeps sliders and buttons usable inside a draggable card
      expect(card).toMatch(/closest\('input, label, button, select, a'\)/)
   })
})
