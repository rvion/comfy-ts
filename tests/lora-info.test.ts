import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import type { ComfyHost } from 'src/host/ComfyHost.ts'
import {
   buildLoraMirror,
   getLoraDisplayName,
   getLoraInfo,
   getLoraPreviewUrl,
   getLoraTriggerWords,
   loraMatchesFilter,
   readLoraMirror,
   reloadLoraInfoCache,
   writeLoraMirror,
} from 'src/host/loraInfoCache.ts'
import type { LmLoraItem } from 'src/host/loraManagerApi.ts'
import { ComfyTS } from 'src/state.ts'

// Synthetic fixture, invented loras: a captured lora-manager sweep describes one
// machine's model collection and never enters this repo (no-personal-lora-data.test.ts
// guards that; lora-corpus.private.test.ts exercises a real local mirror when one exists).
const FIXTURE = 'tests/fixtures/lm-loras-list.synthetic.json'

// the same lora in the three spellings that reach us: a host's object_info
// (windows separators + extension), a posix path, and lm's folder+file pair
const AURORA = 'styles\\aurora-ink-v3.safetensors'
const AURORA_WORDS = 'aurora ink wash style'
const ZEPHYR = 'characters\\zephyr-pilot.safetensors'
const BRASS = 'styles\\brass-gears.safetensors'

let items: LmLoraItem[]
let host: ComfyHost

// the ComfyTS registration is process-wide: borrow it, then hand it back
const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined

afterAll(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
   reloadLoraInfoCache() // this file's mirror must not leak into the next one
})

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   host = new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-lorainfo-')) }).host({
      id: 'lm-host',
      host: '127.0.0.1',
      port: 65501,
   })
   const page: unknown = JSON.parse(readFileSync(FIXTURE, 'utf8'))
   items = (page as { items: LmLoraItem[] }).items
   writeLoraMirror(
      buildLoraMirror({
         hostId: 'lm-host',
         hostUrl: 'http://127.0.0.1:65501',
         fetchedAt: '2026-07-31T00:00:00.000Z',
         items,
      }),
   )
   reloadLoraInfoCache()
})

describe('lora-manager mirror', () => {
   it('keys by folder/file_name, drops rows without one, and keeps the item RAW', () => {
      const mirror = buildLoraMirror({ hostId: 'x', hostUrl: '', fetchedAt: '', items })
      expect(Object.keys(mirror.loras).sort()).toEqual([
         'characters/zephyr-pilot',
         'rootless-helper', // empty folder → the file name alone
         'styles/aurora-ink-v3',
         'styles/brass-gears',
      ])
      expect(mirror.count).toBe(4) // the file_name-less row is gone
      // RAW: a field no getter reads today is still there for a later surface
      expect(mirror.loras['styles/aurora-ink-v3']?.['custom_extra_field']).toContain('stored whole')
   })

   it('round-trips through disk, recounting rather than trusting `count`', () => {
      const back = readLoraMirror('lm-host')
      expect(back?.hostUrl).toBe('http://127.0.0.1:65501')
      expect(back?.count).toBe(4)
      expect(readLoraMirror('never-synced')).toBeNull()
   })

   it('answers for any spelling of a lora name', () => {
      expect(getLoraTriggerWords(AURORA)).toEqual([AURORA_WORDS])
      expect(getLoraTriggerWords('styles/aurora-ink-v3')).toEqual([AURORA_WORDS])
      expect(getLoraDisplayName(AURORA)).toBe('Aurora Ink Wash')
      expect(getLoraPreviewUrl(AURORA)).toContain('/api/lm/previews')
      expect(getLoraTriggerWords(ZEPHYR)).toEqual(['a portrait of zephyr the pilot', 'flight jacket'])
   })

   it('degrades to nothing on a lora it never saw (unsynced host, new download)', () => {
      expect(getLoraInfo('nope/unknown.safetensors')).toBeNull()
      expect(getLoraTriggerWords('nope/unknown.safetensors')).toEqual([])
      expect(getLoraDisplayName('nope/unknown.safetensors')).toBe('unknown.safetensors') // the file name still shows
      expect(getLoraPreviewUrl('nope/unknown.safetensors')).toBeNull()
   })
})

describe('lora filter matches the human name, not just the enum value', () => {
   it('hits on the model name, a tag, the base model or a trigger word', () => {
      expect(loraMatchesFilter(AURORA, 'aurora ink')).toBe(true) // model name
      expect(loraMatchesFilter(AURORA, 'ink aurora')).toBe(true) // tokens are order-free
      expect(loraMatchesFilter(AURORA, 'landscape')).toBe(true) // tag
      expect(loraMatchesFilter(AURORA, 'test base 1')).toBe(true) // base model
      expect(loraMatchesFilter(AURORA, 'styles wash')).toBe(true) // tokens from DIFFERENT fields
      expect(loraMatchesFilter(ZEPHYR, 'flight jacket')).toBe(true) // trigger word
      expect(loraMatchesFilter(ZEPHYR, 'tb2 pilot')).toBe(true) // model name '[TB2 vid] Zephyr the Pilot'
      expect(loraMatchesFilter(AURORA, 'aurora-ink')).toBe(true) // the file name still works
   })

   it('stays TIGHT: fields are matched one by one, never as one concatenated haystack', () => {
      expect(loraMatchesFilter(BRASS, 'aurora ink')).toBe(false)
      expect(loraMatchesFilter(ZEPHYR, 'landscape')).toBe(false)
      expect(loraMatchesFilter(AURORA, '')).toBe(true) // no filter = everything
   })

   it('matches SUBSTRINGS, never subsequences (a 6-letter filter used to return 4 unrelated loras)', () => {
      // a-r-i-a appears IN ORDER inside "aurora ink wash style" and "a portrait
      // of zephyr the pilot": a subsequence match (fuzzyMatch) says yes to both,
      // which is what made the overlay useless on a real collection
      expect(loraMatchesFilter(AURORA, 'aria')).toBe(false)
      expect(loraMatchesFilter(ZEPHYR, 'aria')).toBe(false)
      // a real substring of a trigger sentence still matches
      expect(loraMatchesFilter(ZEPHYR, 'portrait of zephyr')).toBe(true)
   })
})

describe('trigger words become prompt keywords, ⌃K still wins', () => {
   it('resolves mirror → hand override → explicit empty tombstone', async () => {
      const { getLoraKeyword, isLoraKeywordFromMirror, setLoraKeyword } = await import('src/vars/loraKeywords.ts')
      // nobody typed anything: the keyword comes from the mirror
      expect(getLoraKeyword(AURORA)).toBe(AURORA_WORDS)
      expect(isLoraKeywordFromMirror(AURORA)).toBe(true)
      expect(getLoraKeyword(ZEPHYR)).toBe('a portrait of zephyr the pilot, flight jacket') // joined
      expect(getLoraKeyword(BRASS)).toBe('') // civitai gave it no trained words

      // ⌃K overrides
      setLoraKeyword(AURORA, 'my own words')
      expect(getLoraKeyword(AURORA)).toBe('my own words')
      expect(isLoraKeywordFromMirror(AURORA)).toBe(false)

      // ⌃K with an empty value on a lora that HAS trigger words = "inject nothing",
      // stored as an explicit tombstone (deleting would resurrect the trigger words)
      setLoraKeyword(AURORA, '')
      expect(getLoraKeyword(AURORA)).toBe('')
      const saved: unknown = JSON.parse(readFileSync(join(comfyts.baseFolder, 'lora-keywords.json'), 'utf8'))
      expect((saved as Record<string, string>)[AURORA]).toBe('')

      // on a lora with no trigger words there is nothing to shadow: the entry goes away
      setLoraKeyword(BRASS, 'brass')
      setLoraKeyword(BRASS, '')
      const saved2: unknown = JSON.parse(readFileSync(join(comfyts.baseFolder, 'lora-keywords.json'), 'utf8'))
      expect((saved2 as Record<string, string>)[BRASS]).toBeUndefined()
   })

   it('the loras OVERLAY filters on the mirror name, end to end', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const wf = host.defineWorkflow({
         id: 'lora-filter',
         vars: { loras: v.loras([AURORA, BRASS, ZEPHYR]) },
         build: () => {},
      })
      const st = new TuiSt(wf)
      st.selIx = 0
      st.activate()
      expect(st.mode).toBe('overlay-loras')
      // 'flight jacket' appears ONLY in the mirror's trigger words — the file
      // name cannot satisfy it, so this fails if the mirror is not consulted
      for (const ch of 'flight jacket') st.loras.filterInput(ch)
      expect(st.loras.filteredNames).toEqual([ZEPHYR])
      st.loras.toggle()
      expect(wf.vars.loras.activeNames()).toEqual([ZEPHYR])
      st.dispose()
   })

   it('PromptVar prefixes the ACTIVE loras trigger words with nothing typed by hand', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const loras = v.loras([ZEPHYR, BRASS], { [ZEPHYR]: 1 })
      const prompt = v.prompt('a cat', { loraKeywordsFrom: loras })
      expect(prompt.outValue().positive).toBe('a portrait of zephyr the pilot, flight jacket, a cat')
   })
})

describe('tui render smoke (real ink mount, pipe stdout — never a look judgement)', () => {
   it('the overlay OPENS and shows the model name plus the mirror keyword', async () => {
      const { spawnSync } = await import('node:child_process')
      const res = spawnSync('bun', [join(import.meta.dir, 'tui-loras.driver.tsx')], {
         encoding: 'utf8',
         timeout: 30_000,
      })
      expect(res.stdout).toContain('SMOKE_OK')
      // the ink frame carries the file name, the human name, and the injected keyword
      expect(res.stdout).toContain('aurora-ink-v3')
      expect(res.stdout).toContain('Aurora Ink Wash')
      expect(res.stdout).toContain('kw: aurora ink') // the frame wraps the rest of the sentence

      expect(res.status).toBe(0)
   })
})

describe('two hosts never share a lora entry (a merged cache injected the wrong trigger words)', () => {
   // the same FILE NAME on two hosts is routinely a different model: one machine's
   // `styles/portrait.safetensors` has nothing to do with another's
   const SHARED = 'styles\\portrait.safetensors'
   const item = (p: { name: string; word: string }): LmLoraItem => ({
      file_name: 'portrait',
      folder: 'styles',
      model_name: p.name,
      civitai: { trainedWords: [p.word] },
   })

   beforeAll(() => {
      comfyts.host({ id: 'host-b', host: '127.0.0.1', port: 65502 })
      writeLoraMirror(
         buildLoraMirror({
            hostId: 'lm-host',
            hostUrl: '',
            fetchedAt: '',
            items: [...items, item({ name: 'Portrait A', word: 'portrait a style' })],
         }),
      )
      writeLoraMirror(
         buildLoraMirror({
            hostId: 'host-b',
            hostUrl: '',
            fetchedAt: '',
            items: [item({ name: 'Portrait B', word: 'portrait b style' })],
         }),
      )
      reloadLoraInfoCache()
   })

   it('each host reads its OWN metadata for the same name', () => {
      expect(getLoraDisplayName(SHARED, 'lm-host')).toBe('Portrait A')
      expect(getLoraDisplayName(SHARED, 'host-b')).toBe('Portrait B')
      expect(getLoraTriggerWords(SHARED, 'lm-host')).toEqual(['portrait a style'])
      expect(getLoraTriggerWords(SHARED, 'host-b')).toEqual(['portrait b style'])
   })

   it('a host WITH a mirror never borrows another host s entry for a lora it lacks', () => {
      // AURORA exists on lm-host only. host-b has a mirror, so it must answer
      // "I do not know this lora" rather than serve lm-host's entry
      expect(getLoraInfo(AURORA, 'host-b')).toBeNull()
      expect(getLoraTriggerWords(AURORA, 'host-b')).toEqual([])
      expect(getLoraDisplayName(AURORA, 'host-b')).toBe('aurora-ink-v3.safetensors') // falls back to the file name
      expect(getLoraInfo(AURORA, 'lm-host')).not.toBeNull()
   })

   it('the prompt injects the ACTIVE host s trigger words, never the other host s', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const loras = v.loras([SHARED], { [SHARED]: 1 })
      // bindHost is what DefinedWorkflow does at define time
      loras.bindHost({ data: { id: 'host-b' }, schema: { getLoras: () => [SHARED] } })
      const prompt = v.prompt('a cat', { loraKeywordsFrom: loras })
      expect(prompt.outValue().positive).toBe('portrait b style, a cat')
   })

   it('with no hostId at all, any host that knows the name still answers (display fallback)', () => {
      expect(['Portrait A', 'Portrait B']).toContain(getLoraDisplayName(SHARED))
   })
})

describe('a sync in another terminal becomes visible without a restart', () => {
   // its OWN host: rewriting a mirror another test reads is how test files start
   // lying to each other (this exact clobber broke the keyword round trip below)
   it('refreshLoraInfoCacheIfChanged picks up a mirror that appeared after first read', async () => {
      const { refreshLoraInfoCacheIfChanged } = await import('src/host/loraInfoCache.ts')
      comfyts.host({ id: 'host-late', host: '127.0.0.1', port: 65503 })
      const NEW = 'styles\\late-arrival.safetensors'
      // read it once so the host is recorded as "looked at, no mirror"
      expect(getLoraInfo(NEW, 'host-late')).toBeNull()

      // a `comfy-ts loras` run elsewhere writes the file for the first time
      writeLoraMirror(
         buildLoraMirror({
            hostId: 'host-late',
            hostUrl: '',
            fetchedAt: '',
            items: [{ file_name: 'late-arrival', folder: 'styles', model_name: 'Late Arrival' }],
         }),
      )
      expect(getLoraInfo(NEW, 'host-late')).toBeNull() // still stale without a refresh
      refreshLoraInfoCacheIfChanged()
      expect(getLoraDisplayName(NEW, 'host-late')).toBe('Late Arrival')
   })
})

describe('the keyword state machine is a round trip, not a one-way door', () => {
   it('mirror → hand → emptied tombstone → ⌃D → mirror again, all from the overlay', async () => {
      const { v } = await import('src/vars/ComfyVars.ts')
      const { TuiSt } = await import('src/cli/tui/state/TuiSt.ts')
      const { getLoraKeyword, isLoraKeywordFromMirror } = await import('src/vars/loraKeywords.ts')
      const wf = host.defineWorkflow({
         id: 'kw-cycle',
         vars: { loras: v.loras([ZEPHYR]) },
         build: () => {},
      })
      const st = new TuiSt(wf)
      st.selIx = 0
      st.activate()
      const ZEPHYR_WORDS = 'a portrait of zephyr the pilot, flight jacket'

      // 1. mirror: nobody typed anything
      expect(getLoraKeyword(ZEPHYR, 'lm-host')).toBe(ZEPHYR_WORDS)
      expect(isLoraKeywordFromMirror(ZEPHYR, 'lm-host')).toBe(true)

      // 2. hand: ⌃K opens an editor session, committing sets the override
      st.loras.beginKeyword()
      st.editor.buffer = 'my words'
      st.editor.commitInline()
      expect(getLoraKeyword(ZEPHYR, 'lm-host')).toBe('my words')
      expect(isLoraKeywordFromMirror(ZEPHYR, 'lm-host')).toBe(false)

      // 3. tombstone: ⌃K then empty means "inject nothing", NOT "fall back"
      st.loras.beginKeyword()
      st.editor.buffer = ''
      st.editor.commitInline()
      expect(getLoraKeyword(ZEPHYR, 'lm-host')).toBe('')

      // 4. ⌃D is the way back — without it this state was unreachable-in-reverse
      st.loras.resetKeyword()
      expect(getLoraKeyword(ZEPHYR, 'lm-host')).toBe(ZEPHYR_WORDS)
      expect(isLoraKeywordFromMirror(ZEPHYR, 'lm-host')).toBe(true)
      st.dispose()
   })
})
