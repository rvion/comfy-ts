// the anima example: which cfg the sampler gets, and a preview that says when the negative is inert
import { describe, expect, it } from 'bun:test'
import { animaCfg, animaPreview } from 'examples/rvion/10-anima-t2i.cflow.ts'

describe('anima cfg', () => {
   // why we think it is actually a bug, and not just meaning spec should change: the distilled
   // models were pinned to cfg 1, where ComfyUI skips the negative pass, so a negative could never
   // act on turbo; the same seed with and without a negative rendered pixel-identical at cfg 1 and
   // different at cfg 2
   it('the distilled models read turbo cfg, so it can go above 1', () => {
      expect(animaCfg({ model: 'turbo', cfg: 4, turboCfg: 2 })).toBe(2)
      expect(animaCfg({ model: 'base+turbo', cfg: 4, turboCfg: 1 })).toBe(1)
   })

   it('control: aesthetic and base keep reading cfg', () => {
      expect(animaCfg({ model: 'base', cfg: 4.5, turboCfg: 2 })).toBe(4.5)
      expect(animaCfg({ model: 'aesthetic', cfg: 4, turboCfg: 1 })).toBe(4)
   })
})

describe('anima live preview', () => {
   it('at cfg 1 a negative is shown with a note that it does nothing', () => {
      expect(animaPreview({ positive: 'a cat', negative: 'blurry', cfg: 1 })).toBe(
         'a cat\n- blurry\n// the negative is ignored at cfg 1: raise turbo cfg above 1 to use it',
      )
   })

   it('above 1 the negative stands alone, and no negative means no note', () => {
      expect(animaPreview({ positive: 'a cat', negative: 'blurry', cfg: 1.5 })).toBe('a cat\n- blurry')
      expect(animaPreview({ positive: 'a cat', negative: '', cfg: 1 })).toBe('a cat')
   })
})
