// the selection lives in the url so a panel can be SENT to someone: they open the link and
// land on the same workflow and draft you were looking at.
import { describe, expect, it } from 'bun:test'
import { readUrlSelection, resolveSelection, writeUrlSelection } from 'src/cli/serve/web/state/urlSelection.ts'

const MODULES = [
   { module: '04-krea2-turbo-t2i', drafts: ['default', 'sheep fun 2'] },
   { module: '01-txt2img', drafts: ['default'] },
]

describe('reading a url', () => {
   it('takes the workflow and the draft', () => {
      expect(readUrlSelection('?workflow=04-krea2-turbo-t2i&draft=sheep%20fun%202')).toEqual({
         module: '04-krea2-turbo-t2i',
         draft: 'sheep fun 2',
      })
   })

   it('a missing, empty or malformed query asks for nothing — a bad link still opens the panel', () => {
      expect(readUrlSelection('')).toEqual({ module: null, draft: null })
      expect(readUrlSelection('?workflow=&draft=')).toEqual({ module: null, draft: null })
      expect(readUrlSelection('?%%%')).toEqual({ module: null, draft: null })
   })
})

describe('writing a url', () => {
   it('encodes names with spaces, so the link survives a paste into chat', () => {
      const search = writeUrlSelection({ search: '', module: '04-krea2-turbo-t2i', draft: 'sheep fun 2' })
      expect(search).toContain('workflow=04-krea2-turbo-t2i')
      expect(search).toContain('draft=sheep+fun+2')
      expect(readUrlSelection(search)).toEqual({ module: '04-krea2-turbo-t2i', draft: 'sheep fun 2' })
   })

   it('KEEPS params it does not own: the panel does not own the whole query string', () => {
      const search = writeUrlSelection({ search: '?debug=1', module: 'a', draft: 'default' })
      expect(new URLSearchParams(search).get('debug')).toBe('1')
   })

   it('replaces rather than appends, so clicking around cannot grow the url', () => {
      let search = writeUrlSelection({ search: '', module: 'a', draft: 'default' })
      search = writeUrlSelection({ search, module: 'b', draft: 'two' })
      expect(search.match(/workflow=/g)).toHaveLength(1)
      expect(readUrlSelection(search)).toEqual({ module: 'b', draft: 'two' })
   })
})

describe('what opens', () => {
   const stored = { module: '01-txt2img', draft: 'default' }

   it('THE URL WINS over what this browser last had — that is the point of sending a link', () => {
      expect(
         resolveSelection({
            url: { module: '04-krea2-turbo-t2i', draft: 'sheep fun 2' },
            stored,
            modules: MODULES,
         }),
      ).toEqual({ module: '04-krea2-turbo-t2i', draft: 'sheep fun 2' })
   })

   it('with no url, the stored selection still restores', () => {
      expect(resolveSelection({ url: { module: null, draft: null }, stored, modules: MODULES })).toEqual({
         module: '01-txt2img',
         draft: 'default',
      })
   })

   it('a url naming a workflow this server does not serve falls back instead of showing nothing', () => {
      expect(resolveSelection({ url: { module: 'not-here', draft: 'x' }, stored, modules: MODULES })).toEqual({
         module: '01-txt2img',
         draft: 'default',
      })
   })

   it('a draft that no longer exists opens the workflow at default, not at an error', () => {
      expect(
         resolveSelection({ url: { module: '04-krea2-turbo-t2i', draft: 'deleted' }, stored, modules: MODULES }),
      ).toEqual({ module: '04-krea2-turbo-t2i', draft: 'default' })
   })

   it("the stored DRAFT is not carried onto the url's workflow — it belongs to another one", () => {
      expect(
         resolveSelection({
            url: { module: '04-krea2-turbo-t2i', draft: null },
            stored: { module: '01-txt2img', draft: 'default' },
            modules: MODULES,
         }),
      ).toEqual({ module: '04-krea2-turbo-t2i', draft: 'default' })
   })

   it('no workflows at all is null, never a crash', () => {
      expect(resolveSelection({ url: { module: 'a', draft: 'b' }, stored, modules: [] })).toBeNull()
   })
})
