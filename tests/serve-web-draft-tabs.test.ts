import { describe, expect, it } from 'bun:test'
import { closeTab, openTab, readTabs, renameTab, tabForKey, type DraftTab } from 'src/cli/serve/web/state/draftTabs.ts'

const t = (module: string, draft: string): DraftTab => ({ module, draft })
const key = (
   k: string,
   mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {},
) => ({
   key: k,
   metaKey: false,
   ctrlKey: false,
   altKey: false,
   shiftKey: false,
   ...mods,
})

describe('draft tabs', () => {
   it('opening a draft adds its tab once, at the end', () => {
      const a = openTab([], t('wf', 'a'))
      const ab = openTab(a, t('wf', 'b'))
      expect(ab).toEqual([t('wf', 'a'), t('wf', 'b')])
      expect(openTab(ab, t('wf', 'a'))).toBe(ab)
      // same draft name in another workflow is another tab
      expect(openTab(ab, t('other', 'a'))).toHaveLength(3)
   })

   it('closing the open tab moves to its right neighbour, else its left one', () => {
      const tabs = [t('wf', 'a'), t('wf', 'b'), t('wf', 'c')]
      expect(closeTab(tabs, t('wf', 'b'), t('wf', 'b'))).toEqual({
         tabs: [t('wf', 'a'), t('wf', 'c')],
         next: t('wf', 'c'),
      })
      expect(closeTab(tabs, t('wf', 'c'), t('wf', 'c')).next).toEqual(t('wf', 'b'))
      // closing another tab keeps you where you are
      expect(closeTab(tabs, t('wf', 'a'), t('wf', 'c')).next).toBe(null)
   })

   it('the last tab cannot be closed: a draft is always open', () => {
      const one = [t('wf', 'a')]
      expect(closeTab(one, t('wf', 'a'), t('wf', 'a'))).toEqual({ tabs: one, next: null })
   })

   it('a rename keeps the tab in its place', () => {
      const tabs = [t('wf', 'a'), t('wf', 'b'), t('wf', 'c')]
      expect(renameTab(tabs, t('wf', 'a'), t('wf', 'z'))).toEqual([t('wf', 'z'), t('wf', 'b'), t('wf', 'c')])
      // the new name was already open (the switch opened it at the end): one tab, in the old place
      expect(renameTab([...tabs, t('wf', 'z')], t('wf', 'a'), t('wf', 'z'))).toEqual([
         t('wf', 'z'),
         t('wf', 'b'),
         t('wf', 'c'),
      ])
   })

   it('⌘1 to ⌘8 pick that tab, ⌘9 the last one, like a browser', () => {
      const tabs = [t('wf', 'a'), t('wf', 'b'), t('wf', 'c')]
      expect(tabForKey(tabs, key('1', { metaKey: true }))).toEqual(t('wf', 'a'))
      expect(tabForKey(tabs, key('3', { ctrlKey: true }))).toEqual(t('wf', 'c'))
      expect(tabForKey(tabs, key('9', { metaKey: true }))).toEqual(t('wf', 'c'))
      expect(tabForKey(tabs, key('5', { metaKey: true }))).toBe(null)
      expect(tabForKey(tabs, key('1'))).toBe(null)
      expect(tabForKey(tabs, key('1', { metaKey: true, shiftKey: true }))).toBe(null)
   })

   it('a stored list drops junk and tabs whose draft no longer exists', () => {
      const modules = [{ module: 'wf', drafts: ['a', 'b'] }]
      expect(readTabs([t('wf', 'a'), t('wf', 'gone'), t('nope', 'a'), { module: 1 }, 'x'], modules)).toEqual([
         t('wf', 'a'),
      ])
      expect(readTabs(undefined, modules)).toEqual([])
   })
})
