import { describe, expect, it } from 'bun:test'
import { isNewJump } from 'src/cli/serve/web/state/shortcuts.ts'

describe('⌘P / ⌘O jumps', () => {
   // why we think it is actually a bug, and not just meaning spec should change: ⌘O is "open the
   // lora picker NOW"; a tab switch (⌘PageDown) remounts the form, and a press made before that
   // mount must not open the picker again on a draft where nobody pressed anything
   it('a press made before the var mounted does not replay', () => {
      const pressed = { kind: 'loras' as const, seq: 3 }
      expect(isNewJump(pressed, 'loras', 3)).toBe(false)
   })

   it('a press after the mount opens it (control)', () => {
      expect(isNewJump({ kind: 'loras', seq: 4 }, 'loras', 3)).toBe(true)
      expect(isNewJump({ kind: 'prompt', seq: 1 }, 'prompt', 0)).toBe(true)
   })

   it('a press for another kind, or no press, does nothing (control)', () => {
      expect(isNewJump({ kind: 'prompt', seq: 4 }, 'loras', 3)).toBe(false)
      expect(isNewJump(null, 'loras', 0)).toBe(false)
   })
})
