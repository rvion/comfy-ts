// the size list is a scrolling menu: anything that sticks out of it scrolls it sideways, and the
// horizontal scrollbar that appears covers the last row
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { STYLES } from 'src/cli/serve/web/styles.ts'

const rule = (selector: string): string => {
   // at the start of a line, so `.a .b {` is never read as the rule for `.b`
   const at = STYLES.indexOf(`\n${selector} {`)
   return at === -1 ? '' : STYLES.slice(at, STYLES.indexOf('}', at))
}

describe('size preset list', () => {
   it('never scrolls sideways, so the last preset stays clickable', () => {
      // why we think it is actually a bug, and not just meaning spec should change: hovering a
      // star drew its tooltip past the right edge, a horizontal scrollbar appeared over the last
      // row, and `9:16 tall` could not be picked
      expect(rule('.size-menu')).toContain('overflow-x: hidden')
      const control = readFileSync('src/cli/serve/web/components/controls/SizeControl.tsx', 'utf8')
      const star = control.slice(
         control.indexOf('className={starred'),
         control.indexOf('</button>', control.indexOf('className={starred')),
      )
      expect(star).not.toContain('data-tip')
   })

   it('a preset name stays on one line', () => {
      expect(rule('.size-item-label')).toContain('white-space: nowrap')
   })

   it('control: the other menus keep their own rules', () => {
      expect(rule('.preset-menu')).toContain('overflow-y: auto')
   })
})

describe('the lora details image', () => {
   it('keeps its own ratio beside a tall details list', () => {
      // why we think it is actually a bug, and not just meaning spec should change: the sheet is
      // a flex row, which stretches its children to the row's height, so the preview was drawn
      // as tall as the text column beside it and came out distorted
      const r = rule('.detail-thumb')
      expect(r).toContain('align-self: flex-start')
      expect(r).toContain('object-fit: contain')
      expect(r).toContain('height: auto')
   })
})
