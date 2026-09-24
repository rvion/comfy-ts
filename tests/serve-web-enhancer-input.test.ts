// reopening the enhancer keeps the input you were working on; one button copies the prompt in
import { describe, expect, it } from 'bun:test'
import { generateOverride, openingInput, promptTextOf, withCandidate } from 'src/cli/serve/web/state/EnhancerSt.ts'

describe('the enhancer input across opens', () => {
   // why we think it is actually a bug, and not just meaning spec should change: an input you
   // edited and enhanced was wiped by the prompt's text on every open, so iterating on one
   // sketch meant retyping it
   it('a reopen keeps the previous input', () => {
      expect(openingInput({ previous: 'my sketch', prompt: 'the prompt' })).toBe('my sketch')
   })

   it('control: the first open starts from the prompt', () => {
      expect(openingInput({ previous: '', prompt: 'the prompt' })).toBe('the prompt')
   })

   it('the prompt text of a plain var, and of one lane', () => {
      const lanes = {
         lanes: [
            { name: 'main', prompt: 'a cat', active: true },
            { name: 'style', prompt: 'ink', active: false },
         ],
      }
      expect(promptTextOf('a dog', null)).toBe('a dog')
      expect(promptTextOf(lanes, 1)).toBe('ink')
      expect(promptTextOf(lanes, 5)).toBe('')
      expect(promptTextOf(42, null)).toBe('')
   })
})

describe('trying a candidate', () => {
   it('a plain prompt is replaced by the candidate', () => {
      expect(withCandidate('old', null, 'new')).toBe('new')
   })

   it('in lanes mode only the refined lane changes, the others and their order stay', () => {
      const lanes = {
         lanes: [
            { name: 'main', prompt: 'a cat', active: true },
            { name: 'style', prompt: 'ink', active: false },
         ],
      }
      expect(withCandidate(lanes, 0, 'a tabby cat')).toEqual({
         lanes: [
            { name: 'main', prompt: 'a tabby cat', active: true },
            { name: 'style', prompt: 'ink', active: false },
         ],
      })
   })
})

describe('what ⌘⏎ generates', () => {
   const target = { name: 'prompt', value: 'a cat' }

   it('with the enhancer open and a rewrite, the rewrite is tried in place of the prompt', () => {
      expect(generateOverride({ open: true, target, lane: null, result: ' a tabby cat ' })).toEqual({
         prompt: 'a tabby cat',
      })
   })

   it('with no rewrite yet, or the enhancer closed, the draft as the form has it', () => {
      expect(generateOverride({ open: true, target, lane: null, result: '  ' })).toBeUndefined()
      expect(generateOverride({ open: false, target, lane: null, result: 'a tabby cat' })).toBeUndefined()
   })
})
