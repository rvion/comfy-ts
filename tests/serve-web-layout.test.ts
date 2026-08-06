// every placement is a BUTTON. There used to be an 'auto' meaning "right on a wide screen,
// bottom on a narrow one": no button could show it as selected, so the panel sat somewhere
// nobody could name or point at, and clicking the lit button fell back into it.
import { describe, expect, it } from 'bun:test'
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
      // `bottom` is the plain block flow: results after the form, which is what the dom
      // already says. A rule for it would be a rule that changes nothing
      for (const id of ['left', 'side', 'pinned']) expect(STYLES).toContain(`.work.layout-${id}`)
      expect(STYLES).not.toContain('layout-bottom')
      // and nothing is left of the mode no button could show
      expect(STYLES).not.toContain('layout-auto')
   })
})
