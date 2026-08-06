// the picker and the payload validator build the manager-only lora list from ONE function.
// They used to build it twice: the picker derived the separator from the host's enum, the
// validator took the '/' default, and applyVarPayload compares raw strings — so on a windows
// host the ui offered `styles\x.safetensors` and the api answered "unknown lora(s)".
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import { managerOnlyLoraOptions } from 'src/cli/serve/managerOnlyLoras.ts'
import { buildLoraMirror, reloadLoraInfoCache, writeLoraMirror } from 'src/host/loraInfoCache.ts'
import type { LmLoraItem } from 'src/host/loraManagerApi.ts'
import { ComfyTS } from 'src/state.ts'

const FIXTURE = 'tests/fixtures/lm-loras-list.synthetic.json'
const globalHack = globalThis as { comfyts?: ComfyTS }
let prior: ComfyTS | undefined

beforeAll(() => {
   prior = globalHack.comfyts
   Reflect.deleteProperty(globalThis, 'comfyts')
   new ComfyTS({ rootPath: mkdtempSync(join(tmpdir(), 'comfy-ts-monly-')) }).host({
      id: 'win-host',
      host: '127.0.0.1',
      port: 65502,
   })
   const page: unknown = JSON.parse(readFileSync(FIXTURE, 'utf8'))
   writeLoraMirror(
      buildLoraMirror({
         hostId: 'win-host',
         hostUrl: 'http://127.0.0.1:65502',
         fetchedAt: '2026-08-06T00:00:00.000Z',
         items: (page as { items: LmLoraItem[] }).items,
      }),
   )
   reloadLoraInfoCache()
})

afterAll(() => {
   if (prior != null) globalHack.comfyts = prior
   else Reflect.deleteProperty(globalThis, 'comfyts')
   reloadLoraInfoCache()
})

describe('manager-only lora options', () => {
   it("takes the separator from the var's OWN enum, so a windows host gets backslash names", () => {
      const winOptions = ['characters\\zephyr-pilot.safetensors']
      const extras = managerOnlyLoraOptions({ hostId: 'win-host', options: winOptions })
      expect(extras).toContain('styles\\aurora-ink-v3.safetensors')
      expect(extras.every((n) => !n.includes('/'))).toBe(true)
   })

   it('a posix enum gets posix names', () => {
      const extras = managerOnlyLoraOptions({ hostId: 'win-host', options: ['characters/zephyr-pilot.safetensors'] })
      expect(extras).toContain('styles/aurora-ink-v3.safetensors')
      expect(extras.every((n) => !n.includes('\\'))).toBe(true)
   })

   it('what the enum already lists is not offered twice, compared by KEY not raw string', () => {
      // the enum spells it with a backslash and an extension, the mirror keys it 'styles/aurora-ink-v3'
      const extras = managerOnlyLoraOptions({ hostId: 'win-host', options: ['styles\\aurora-ink-v3.safetensors'] })
      expect(extras.some((n) => n.toLowerCase().includes('aurora'))).toBe(false)
   })

   it("the var's own regex narrows the mirror too", () => {
      const extras = managerOnlyLoraOptions({ hostId: 'win-host', options: [], filter: /zephyr/i })
      expect(extras).toEqual(['characters/zephyr-pilot.safetensors'])
   })

   it('an unsynced host offers nothing', () => {
      expect(managerOnlyLoraOptions({ hostId: 'never-synced', options: [] })).toEqual([])
   })

   it('a /g filter gives the SAME set on every call — the picker and the validator each call it once', () => {
      // RegExp.test advances lastIndex on a global regex, so the second caller used to get a
      // different set: the panel offered a lora the api then answered 'unknown lora(s)' to
      const filter = /e/gi
      const first = managerOnlyLoraOptions({ hostId: 'win-host', options: [], filter })
      const second = managerOnlyLoraOptions({ hostId: 'win-host', options: [], filter })
      expect(second).toEqual(first)
      expect(first.length).toBeGreaterThan(1)
   })
})
