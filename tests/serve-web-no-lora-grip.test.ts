// the lora card has NO grip. The whole card is the drag source (mousedown disarms it when
// the press lands on a control), so a permanent handle is chrome that buys nothing.
// This is a guard, not a style opinion: the grip came back three times.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const card = readFileSync('src/cli/serve/web/components/controls/LorasControl.tsx', 'utf8')
const css = readFileSync('src/cli/serve/web/styles.ts', 'utf8')

describe('lora card chrome', () => {
   it('renders no grip', () => {
      expect(card).not.toContain('chip-grip')
      expect(card).not.toContain("name=\"grip\"")
      expect(card).not.toContain("name='grip'")
      expect(css).not.toContain('chip-grip')
   })

   it('still drags: the card carries draggable + the disarm', () => {
      expect(card).toContain('onDragStart')
      expect(card).toContain('closest(')
   })
})
