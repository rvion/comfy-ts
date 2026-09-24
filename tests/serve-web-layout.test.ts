// every placement is a BUTTON. There used to be an 'auto' meaning "right on a wide screen,
// bottom on a narrow one": no button could show it as selected, so the panel sat somewhere
// nobody could name or point at, and clicking the lit button fell back into it.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { DEFAULT_LAYOUT, LAYOUTS, type ResultsLayout } from 'src/cli/serve/web/state/WebSt.ts'
import { STYLES } from 'src/cli/serve/web/styles.ts'

describe('results placement', () => {
   it('the default is the right-hand column, and it HAS a button', () => {
      expect(DEFAULT_LAYOUT).toBe('side')
      expect(LAYOUTS.map((l) => l.id)).toContain(DEFAULT_LAYOUT)
   })

   it('every mode is offered, and every button is a real mode', () => {
      const ids = LAYOUTS.map((l) => l.id)
      const all: ResultsLayout[] = ['off', 'bottom', 'left', 'side', 'pinned']
      expect([...ids].sort()).toEqual([...all].sort())
      expect(new Set(ids).size).toBe(ids.length)
   })

   it('each mode carries its own icon and tooltip', () => {
      for (const l of LAYOUTS) {
         expect(l.icon).not.toBe('')
         expect(l.title.length).toBeGreaterThan(4)
      }
      expect(new Set(LAYOUTS.map((l) => l.icon)).size).toBe(LAYOUTS.length)
   })

   it('the stylesheet places every mode that needs placing', () => {
      // `bottom` is the plain block flow (results after the form, as the dom says) plus the gap
      // that keeps the boxed preview off the form
      for (const id of ['left', 'side', 'pinned', 'bottom']) expect(STYLES).toContain(`.work.layout-${id}`)
      // and nothing is left of the mode no button could show
      expect(STYLES).not.toContain('layout-auto')
   })
})

describe('side by side split', () => {
   it('the split never carries the stacked-page classes, whose rules stop its panels from scrolling', () => {
      // why we think it is actually a bug, and not just meaning spec should change: with
      // layout-side on the split, `align-items: flex-start` let both panels grow with their
      // content, the window cut the form off and nothing scrolled (measured in chrome: last row
      // at 1071px in a 513px window). scripts/check-panel-scroll.ts is the browser check
      const app = readFileSync('src/cli/serve/web/components/App.tsx', 'utf8')
      const line = app.split('\n').find((l) => l.includes('className={`work split'))
      expect(line).toBeDefined()
      expect(line).not.toContain('layout-')
      expect(STYLES).toContain('.work.split { flex: 1; min-width: 0; height: 100%; gap: 0; align-items: stretch; }')
   })
})
