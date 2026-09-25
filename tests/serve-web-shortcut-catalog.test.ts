import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { shortcutCatalog, type ShortcutGroup } from 'src/cli/serve/web/state/shortcutCatalog.ts'

/** codemirror bindings in a source that no catalog row names */
function uncovered(source: string, catalog: ShortcutGroup[]): string[] {
   const bound = [...source.matchAll(/\{\s*key:\s*'([^']+)'/g)].map((m) => m[1] ?? '')
   const listed = new Set(catalog.flatMap((g) => g.rows.flatMap((r) => r.cm ?? [])))
   return bound.filter((k) => !listed.has(k))
}

describe('the shortcuts popup lists every key', () => {
   it('every prompt editor binding has a row', () => {
      const src = readFileSync('src/cli/serve/web/promptEditor/promptExtensions.ts', 'utf8')
      expect(uncovered(src, shortcutCatalog('⌘'))).toEqual([])
   })

   it('the guard reports a binding nobody listed (sample)', () => {
      const src = `keymap.of([{ key: 'Mod-/', run: a }, { key: 'Mod-q', run: b }])`
      expect(uncovered(src, shortcutCatalog('⌘'))).toEqual(['Mod-q'])
   })

   it('the jump keys come from their table', () => {
      const all = shortcutCatalog('⌘').flatMap((g) => g.rows.flatMap((r) => r.keys))
      for (const k of ['⌘P', '⌘O', '⌘E', 'F2', '⌘D', '⌘B', '⌘U', '⌘I', '⌘K', '⌘PageDown']) expect(all).toContain(k)
   })
})
