import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { describeVar } from 'src/cli/serve/describeVar.ts'
import { ServeApp, type ServeModule } from 'src/cli/serve/ServeApp.ts'
import { parseTagList, TagList } from 'src/cli/serve/tagList.ts'
import { resolveTagSource, TagSources } from 'src/cli/serve/tagSource.ts'
import { ComfyTS } from 'src/state.ts'
import { v } from 'src/vars/ComfyVars.ts'

// the a1111 tagcomplete shape, rows out of count order on purpose
const CSV = [
   'long_hair,0,4350743,"/lh,longhair"',
   '1girl,0,6008644,"1girls,sole_female"',
   'silver_hair,0,300000,"grey_hair_(silver)"',
   'hammer_(sunset_beach),1,5418,aenobas',
   'very_long_hair,0,900000,',
   'long_coat,0,90000,',
].join('\n')

describe('tag list', () => {
   it('parses the tagcomplete csv, quoted aliases included', () => {
      expect(parseTagList(CSV)[0]).toEqual({
         name: 'long_hair',
         category: 0,
         count: 4350743,
         aliases: ['/lh', 'longhair'],
      })
   })
   it('parses a plain list and a counted plain list', () => {
      expect(parseTagList('smile\n# a comment\n\nblush')).toEqual([
         { name: 'smile', category: null, count: 0, aliases: [] },
         { name: 'blush', category: null, count: 0, aliases: [] },
      ])
      expect(parseTagList('smile,120')[0]).toEqual({ name: 'smile', category: null, count: 120, aliases: [] })
   })
   it('search: name prefix by count, then aliases, then a word inside', () => {
      const list = TagList.parse(CSV)
      expect(list.search('long').map((h) => h.name)).toEqual(['long_hair', 'long_coat', 'very_long_hair'])
      expect(list.search('long h').map((h) => h.name)).toEqual(['long_hair', 'very_long_hair'])
      expect(list.search('hair').map((h) => h.name)).toEqual(['long_hair', 'very_long_hair', 'silver_hair'])
      expect(list.search('aeno')).toEqual([{ name: 'hammer_(sunset_beach)', category: 1, count: 5418, alias: 'aenobas' }])
      expect(list.search('LONGH')[0]?.name).toBe('long_hair')
      expect(list.search('')).toEqual([])
   })
})

describe('tag source', () => {
   it('resolves paths against the workflow file', () => {
      expect(resolveTagSource('https://x/tags.csv', '/w/a.cflow.ts')).toEqual({ kind: 'http', url: 'https://x/tags.csv' })
      expect(resolveTagSource('./tags.csv', '/w/sub/a.cflow.ts')).toEqual({ kind: 'file', path: '/w/sub/tags.csv' })
      expect(resolveTagSource('/abs/t.csv', '/w/a.cflow.ts')).toEqual({ kind: 'file', path: '/abs/t.csv' })
      expect(resolveTagSource('file:///abs/t.csv', '/w/a.cflow.ts')).toEqual({ kind: 'file', path: '/abs/t.csv' })
   })
   it('a remote list is fetched once, then read from the cache dir', async () => {
      const cacheDir = mkdtempSync(join(tmpdir(), 'comfy-ts-tags-'))
      let fetches = 0
      const make = (): TagSources =>
         new TagSources({
            cacheDir: () => cacheDir,
            fetchText: () => {
               fetches++
               return Promise.resolve(CSV)
            },
         })
      const first = await make().load({ kind: 'http', url: 'https://x/tags.csv' })
      const again = await make().load({ kind: 'http', url: 'https://x/tags.csv' })
      expect(first.entries.length).toBe(6)
      expect(again.entries.length).toBe(6)
      expect(fetches).toBe(1)
   })
   it('a failed fetch is not remembered', async () => {
      let fail = true
      const src = new TagSources({
         cacheDir: () => mkdtempSync(join(tmpdir(), 'comfy-ts-tags-')),
         fetchText: () => (fail ? Promise.reject(new Error('offline')) : Promise.resolve(CSV)),
      })
      await expect(src.load({ kind: 'http', url: 'https://y/t.csv' })).rejects.toThrow('offline')
      fail = false
      expect((await src.load({ kind: 'http', url: 'https://y/t.csv' })).entries.length).toBe(6)
   })
})

describe('GET /tags/<module>/<var>', () => {
   const globalHack = globalThis as { comfyts?: ComfyTS }
   let prior: ComfyTS | undefined
   let app: ServeApp
   let dir: string
   beforeAll(() => {
      prior = globalHack.comfyts
      Reflect.deleteProperty(globalThis, 'comfyts')
      dir = mkdtempSync(join(tmpdir(), 'comfy-ts-serve-tags-'))
      const comfy = ComfyTS.create({ rootPath: dir })
      writeFileSync(join(dir, 'tags.csv'), CSV)
      const host = comfy.host({ id: 'serve-tags-host', host: '127.0.0.1', port: 65501 })
      const dw = host.defineWorkflow({
         id: 'tagged',
         vars: {
            prompt: v.prompt('', { tags: { url: './tags.csv', artistPrefix: '@' } }),
            missing: v.prompt('', { tags: './nope.csv' }),
            plain: v.prompt(''),
         },
         build: () => {},
      })
      const mod: ServeModule = { key: 'tagged', file: join(dir, 'tagged.cflow.ts'), dw }
      app = new ServeApp([mod], { starter: () => Promise.reject(new Error('no runs here')) })
   })
   afterAll(() => {
      if (prior != null) globalHack.comfyts = prior
      else Reflect.deleteProperty(globalThis, 'comfyts')
   })
   const get = (url: string) => app.handle({ method: 'GET', url, body: '' })

   it('answers hits from the list next to the workflow file', async () => {
      const r = await get('/tags/tagged/prompt?q=sil&limit=5')
      expect(r.status).toBe(200)
      expect(JSON.parse(String(r.body))).toEqual({ hits: [{ name: 'silver_hair', category: 0, count: 300000 }] })
   })
   it('a missing list is a loud error, not an empty answer', async () => {
      const r = await get('/tags/tagged/missing?q=a')
      expect(r.status).toBe(502)
      expect(String(r.body)).toContain('tag list not found')
   })
   it('a prompt without tags says so', async () => {
      const r = await get('/tags/tagged/plain?q=a')
      expect(r.status).toBe(404)
      expect(String(r.body)).toContain('declares no tag list')
   })
   it('the descriptor carries the insert rules, never the url', () => {
      const prompt = app.modules[0]?.dw.entries().find(([k]) => k === 'prompt')?.[1]
      expect(prompt == null ? null : describeVar(prompt).tags).toEqual({ underscores: false, artistPrefix: '@' })
   })
})
