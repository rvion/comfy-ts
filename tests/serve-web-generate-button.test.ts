import { describe, expect, it } from 'bun:test'
import { generateButtonLook } from 'src/cli/serve/web/state/generateButton.ts'

describe('the generate button never changes size during a run', () => {
   it('the text is the same idle and at every percent, the progress is a fill', () => {
      // why we think it is actually a bug, and not just meaning spec should change: the label
      // went "generate" → "generating… 7%" → "generating… 42%", so the button changed width on
      // every tick and moved everything beside it
      const idle = generateButtonLook({ isRunning: false, percent: null })
      const early = generateButtonLook({ isRunning: true, percent: 7 })
      const late = generateButtonLook({ isRunning: true, percent: 42 })
      expect(early.label).toBe(idle.label)
      expect(late.label).toBe(idle.label)
      expect(idle.fill).toBeNull()
      expect(late.fill).toBe(42)
   })

   it('a run with no percent yet fills nothing but still runs', () => {
      expect(generateButtonLook({ isRunning: true, percent: null })).toEqual({
         label: 'Run',
         fill: 0,
         running: true,
      })
   })
})
