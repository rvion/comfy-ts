// the preview pane never shifts: chips and collapsed previews keep one shape whatever they say
import { describe, expect, it } from 'bun:test'
import { collapsedPreview, runChipText } from 'src/cli/serve/web/state/stableSlots.ts'

describe('run chips', () => {
   it('the label never changes with the count, no plural to grow the chip', () => {
      expect(runChipText({ kind: 'results', count: 1 }).label).toBe('results')
      expect(runChipText({ kind: 'results', count: 12 }).label).toBe('results')
      expect(runChipText({ kind: 'queue', count: 0 })).toEqual({ label: 'queue', count: '0' })
   })

   it('the count is capped at three digits, the width the css reserves', () => {
      expect(runChipText({ kind: 'results', count: 5000 }).count).toBe('999')
      expect(runChipText({ kind: 'queue', count: -3 }).count).toBe('0')
   })
})

describe('collapsed prompt preview', () => {
   it('is always one positive and one negative line', () => {
      expect(collapsedPreview('a cat\non a mat\n- blurry\n- jpeg')).toEqual({
         positive: 'a cat · on a mat',
         negative: 'blurry · jpeg',
      })
   })

   it('no negative line still yields the empty negative slot, never a missing one', () => {
      expect(collapsedPreview('a cat')).toEqual({ positive: 'a cat', negative: '' })
      expect(collapsedPreview('')).toEqual({ positive: '', negative: '' })
   })
})
