// ⌘P focuses the first prompt, ⌘O opens the first loras picker, ⌘B folds the menu, ⌘U toggles the blur, ⌘K or ⌘J opens the search
import { describe, expect, it } from 'bun:test'
import { enhancerShortcutOf, isOmniboxKey, jumpTargets, shortcutOf } from 'src/cli/serve/web/state/shortcuts.ts'

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
      expect(shortcutOf(key('b', { metaKey: true }))).toBe('toggle-menu')
   })

   it('⌘U blurs, ⌘B folds the menu, ⌘K and ⌘J open the search', () => {
      expect(shortcutOf(key('u', { metaKey: true }))).toBe('toggle-blur')
      expect(shortcutOf(key('U', { ctrlKey: true }))).toBe('toggle-blur')
      expect(shortcutOf(key('b', { metaKey: true }))).toBe('toggle-menu')
      expect(shortcutOf(key('B', { metaKey: true, shiftKey: true }))).toBe(null)
      expect(isOmniboxKey(key('k', { metaKey: true }))).toBe(true)
      expect(isOmniboxKey(key('j', { metaKey: true }))).toBe(true)
      expect(shortcutOf(key('j', { metaKey: true }))).toBe(null)
      expect(isOmniboxKey(key('u', { metaKey: true }))).toBe(false)
   })

   it('⌘E opens the enhancer on the first prompt, the same letter enhances once it is open', () => {
      expect(shortcutOf(key('e', { metaKey: true }))).toBe('open-enhancer')
      expect(enhancerShortcutOf(key('e', { metaKey: true }))).toBe('enhance')
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

describe('enhancer shortcuts: ⌘E enhance, ⌘I apply, ⌘⏎ is the global generate (try, in there)', () => {
   it('⌘E enhances, ⌘I applies', () => {
      expect(enhancerShortcutOf(key('e', { metaKey: true }))).toBe('enhance')
      expect(enhancerShortcutOf(key('i', { metaKey: true }))).toBe('apply')
   })

   it('⌘G is no longer an action: try rides ⌘⏎, which the global handler owns', () => {
      expect(enhancerShortcutOf(key('g', { metaKey: true }))).toBeNull()
      expect(enhancerShortcutOf(key('Enter', { metaKey: true }))).toBeNull()
   })

   it('control: a plain letter or another modifier is not an action', () => {
      expect(enhancerShortcutOf(key('e', {}))).toBeNull()
      expect(enhancerShortcutOf(key('e', { metaKey: true, shiftKey: true }))).toBeNull()
   })
})
