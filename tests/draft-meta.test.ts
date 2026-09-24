// the enhancer's intent lives IN the draft file, beside the prompt it refines: `$enhance`
import { describe, expect, it } from 'bun:test'
import { ENHANCE_KEY, intentKey, preserveDraftMeta, readIntents } from 'src/cli/draftMeta.ts'

describe('draft meta', () => {
   it('one intent per prompt, or per lane', () => {
      expect(intentKey('prompt', null)).toBe('prompt')
      expect(intentKey('prompt', 2)).toBe('prompt#2')
   })

   it('a broken $enhance degrades entry by entry', () => {
      expect(readIntents({ prompt: 'a cat', neg: 3, 'prompt#1': '' })).toEqual({ prompt: 'a cat' })
      expect(readIntents('nope')).toEqual({})
      expect(readIntents(undefined)).toEqual({})
   })

   // why we think it is actually a bug, and not just meaning spec should change: the TUI writes a
   // draft from its var values alone, which would drop the intent the panel stored in the same file
   it('a writer that only knows the vars keeps the intent the file carried', () => {
      const prev = { prompt: 'old', [ENHANCE_KEY]: { prompt: 'my sketch' } }
      expect(preserveDraftMeta(prev, { prompt: 'new' })).toEqual({
         prompt: 'new',
         [ENHANCE_KEY]: { prompt: 'my sketch' },
      })
   })

   it('control: a writer that sends its own $enhance wins, and a missing file adds nothing', () => {
      const prev = { [ENHANCE_KEY]: { prompt: 'old sketch' } }
      expect(preserveDraftMeta(prev, { [ENHANCE_KEY]: { prompt: 'new sketch' } })).toEqual({
         [ENHANCE_KEY]: { prompt: 'new sketch' },
      })
      expect(preserveDraftMeta(null, { prompt: 'x' })).toEqual({ prompt: 'x' })
   })
})
