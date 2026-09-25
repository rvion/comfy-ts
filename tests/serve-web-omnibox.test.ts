import { describe, expect, it } from 'bun:test'
import { fuzzyScore, omniboxEntries, searchOmnibox, type OmniboxEntry } from 'src/cli/serve/web/state/omnibox.ts'

const MODULES = [
   {
      module: '04-krea2-turbo-t2i',
      file: '/r/examples/rvion/04-krea2-turbo-t2i.cflow.ts',
      host: 'windows-1',
      drafts: ['default', 'jester', 'mouse at dawn'],
      tags: ['image'],
   },
   {
      module: '07-local-llm-text-gen',
      file: '/r/examples/rvion/07-local-llm-text-gen.cflow.ts',
      host: 'windows-1',
      drafts: [],
      tags: ['text', 'llm'],
   },
   {
      module: 'anima-t2i',
      file: '/r/examples/comfy-cloud/anima-t2i.cflow.ts',
      host: 'comfy-cloud',
      drafts: ['default'],
      tags: ['image'],
   },
   {
      module: '13-ace-step-15-xl-t2a',
      file: '/r/examples/rvion/13-ace-step-15-xl-t2a.cflow.ts',
      host: 'windows-1',
      drafts: ['default', 'neo soul'],
      tags: ['audio', 'song'],
   },
]

const rows = (list: OmniboxEntry[]): string[] =>
   list.map((e) => (e.kind === 'workflow' ? `# ${e.folder}/${e.module}` : `  ${e.draft}`))

describe('omnibox entries', () => {
   it('one workflow row, then its drafts indented under it', () => {
      const krea = rows(omniboxEntries(MODULES).filter((e) => e.module === '04-krea2-turbo-t2i'))
      expect(krea).toEqual(['# examples/rvion/04-krea2-turbo-t2i', '  default', '  jester', '  mouse at dawn'])
   })

   it('a workflow with no saved draft is listed with default, so every workflow is reachable', () => {
      const llm = omniboxEntries(MODULES).filter((e) => e.module === '07-local-llm-text-gen')
      expect(llm.map((e) => `${e.kind} ${e.draft}`)).toEqual(['workflow default', 'draft default'])
   })

   it('a workflow row opens its first draft and carries the tags', () => {
      const head = omniboxEntries(MODULES).find((e) => e.kind === 'workflow' && e.module === '13-ace-step-15-xl-t2a')
      expect(head?.draft).toBe('default')
      expect(head?.tags).toEqual(['audio', 'song'])
   })
})

describe('tag search', () => {
   it('a word that is a tag keeps every workflow carrying it, all drafts shown', () => {
      expect(rows(searchOmnibox(omniboxEntries(MODULES), 'audio'))).toEqual([
         '# examples/rvion/13-ace-step-15-xl-t2a',
         '  default',
         '  neo soul',
      ])
   })

   it('a tag word plus a name narrows inside the tagged workflows', () => {
      const hits = rows(searchOmnibox(omniboxEntries(MODULES), 'image anima'))
      expect(hits).toEqual(['# examples/comfy-cloud/anima-t2i', '  default'])
   })

   it('a partial tag still matches through fuzzy search', () => {
      expect(rows(searchOmnibox(omniboxEntries(MODULES), 'llm'))[0]).toBe('# examples/rvion/07-local-llm-text-gen')
      expect(rows(searchOmnibox(omniboxEntries(MODULES), 'aud'))[0]).toBe('# examples/rvion/13-ace-step-15-xl-t2a')
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
      expect(rows(searchOmnibox(omniboxEntries(MODULES), 'anima'))[0]).toBe('# examples/comfy-cloud/anima-t2i')
   })

   it('a draft name keeps only the matching drafts, under their workflow row', () => {
      expect(rows(searchOmnibox(omniboxEntries(MODULES), 'mouse'))).toEqual([
         '# examples/rvion/04-krea2-turbo-t2i',
         '  mouse at dawn',
      ])
   })

   it('an empty query lists everything in folder order', () => {
      const all = omniboxEntries(MODULES)
      expect(searchOmnibox(all, '  ')).toEqual(all)
   })

   it('no match is an empty list, never a fallback to everything', () => {
      expect(searchOmnibox(omniboxEntries(MODULES), 'zzzz')).toEqual([])
   })
})
