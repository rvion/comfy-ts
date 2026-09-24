import { describe, expect, it } from 'bun:test'
import { fuzzyScore, omniboxEntries, searchOmnibox } from 'src/cli/serve/web/state/omnibox.ts'

const MODULES = [
   {
      module: '04-krea2-turbo-t2i',
      file: '/r/examples/rvion/04-krea2-turbo-t2i.cflow.ts',
      host: 'windows-1',
      drafts: ['default', 'jester', 'mouse at dawn'],
   },
   {
      module: '07-local-llm-text-gen',
      file: '/r/examples/rvion/07-local-llm-text-gen.cflow.ts',
      host: 'windows-1',
      drafts: [],
   },
   {
      module: 'anima-t2i',
      file: '/r/examples/comfy-cloud/anima-t2i.cflow.ts',
      host: 'comfy-cloud',
      drafts: ['default'],
   },
]

describe('omnibox entries', () => {
   it('one entry per draft, labelled folder/workflow/draft', () => {
      const labels = omniboxEntries(MODULES).map((e) => e.label)
      expect(labels).toContain('examples/rvion/04-krea2-turbo-t2i/jester')
      expect(labels).toContain('examples/comfy-cloud/anima-t2i/default')
   })

   it('a workflow with no saved draft is listed with default, so every workflow is reachable', () => {
      const llm = omniboxEntries(MODULES).filter((e) => e.module === '07-local-llm-text-gen')
      expect(llm.map((e) => e.draft)).toEqual(['default'])
   })
})

describe('fuzzy matching', () => {
   it('letters in order match, out of order do not', () => {
      expect(fuzzyScore('krj', 'rvion/04-krea2-turbo-t2i/jester')).not.toBeNull()
      expect(fuzzyScore('jrk', 'rvion/04-krea2-turbo-t2i/jester')).toBeNull()
   })

   it('case and spaces in the query do not matter', () => {
      expect(fuzzyScore('KREA JES', 'rvion/04-krea2-turbo-t2i/jester')).not.toBeNull()
   })

   it('word starts and consecutive letters rank above scattered hits', () => {
      const hits = searchOmnibox(omniboxEntries(MODULES), 'anima').map((e) => e.label)
      expect(hits[0]).toBe('examples/comfy-cloud/anima-t2i/default')
   })

   it('the draft name alone finds its draft first', () => {
      expect(searchOmnibox(omniboxEntries(MODULES), 'mouse')[0]?.label).toBe(
         'examples/rvion/04-krea2-turbo-t2i/mouse at dawn',
      )
   })

   it('an empty query lists everything in folder order', () => {
      const all = omniboxEntries(MODULES)
      expect(searchOmnibox(all, '  ')).toEqual(all)
   })

   it('no match is an empty list, never a fallback to everything', () => {
      expect(searchOmnibox(omniboxEntries(MODULES), 'zzzz')).toEqual([])
   })
})
