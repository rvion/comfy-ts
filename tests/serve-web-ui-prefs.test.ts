// every hand-tuned view setting survives a reload: they are all one localStorage blob, and a
// toggle that is read back but never written looks like the panel forgot what you asked for.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const src = readFileSync('src/cli/serve/web/state/WebSt.ts', 'utf8')

/** the stored key each toggle rides, and the method that flips it */
const PERSISTED = [
   { key: 'logs', toggle: 'toggleLogs' },
   { key: 'latent', toggle: 'toggleLatent' },
   { key: 'loraImages', toggle: 'toggleLoraImages' },
   { key: 'loraTitles', toggle: 'toggleLoraTitles' },
   { key: 'loraFill', toggle: 'toggleLoraFill' },
   { key: 'sidebar', toggle: 'toggleSidebar' },
]

describe('ui preferences survive a reload', () => {
   it('every toggle writes the blob', () => {
      const missing = PERSISTED.filter((p) => {
         const at = src.indexOf(`${p.toggle}(): void {`)
         if (at === -1) return true
         return !src.slice(at, src.indexOf('\n   }', at)).includes('this.persist()')
      })
      expect(missing.map((m) => m.toggle)).toEqual([])
   })

   it('every toggle is written INTO the blob and read back OUT of it', () => {
      const unwritten = PERSISTED.filter((p) => !new RegExp(`${p.key}: this\\.`).test(src))
      expect(unwritten.map((m) => m.key)).toEqual([])
      const unread = PERSISTED.filter((p) => !new RegExp(`stored\\.${p.key}\\b`).test(src))
      expect(unread.map((m) => m.key)).toEqual([])
   })
})
