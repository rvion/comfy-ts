// ⌘P focuses the first prompt, ⌘O opens the first loras picker, ⌘B toggles the blur
import { describe, expect, it } from 'bun:test'
import { jumpTargets, shortcutOf } from 'src/cli/serve/web/state/shortcuts.ts'

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({
   key: k,
   metaKey: false,
   ctrlKey: false,
   altKey: false,
   shiftKey: false,
   ...mods,
})

describe('panel shortcuts', () => {
   it('maps ⌘ or ctrl plus the letter, either case', () => {
      expect(shortcutOf(key('p', { metaKey: true }))).toBe('focus-prompt')
      expect(shortcutOf(key('O', { ctrlKey: true }))).toBe('open-loras')
      expect(shortcutOf(key('b', { metaKey: true }))).toBe('toggle-blur')
   })

   it('ignores the letter alone, another modifier, and other letters', () => {
      expect(shortcutOf(key('p', {}))).toBeNull()
      expect(shortcutOf(key('p', { metaKey: true, shiftKey: true }))).toBeNull()
      expect(shortcutOf(key('b', { metaKey: true, altKey: true }))).toBeNull()
      expect(shortcutOf(key('k', { metaKey: true }))).toBeNull()
   })

   it('jumps to the first var of each kind in the order shown, skipping a disabled one', () => {
      const t = jumpTargets([
         { name: 'neg', kind: 'prompt', inactive: true },
         { name: 'style', kind: 'loras', inactive: false },
         { name: 'pos', kind: 'prompt', inactive: false },
         { name: 'more', kind: 'loras', inactive: false },
      ])
      expect(t).toEqual({ prompt: 'pos', loras: 'style' })
      expect(jumpTargets([])).toEqual({ prompt: null, loras: null })
   })
})
