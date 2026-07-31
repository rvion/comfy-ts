import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'pathe'
import { buildLoraMirror, loraMatchesFilter, reloadLoraInfoCache, writeLoraMirror } from 'src/host/loraInfoCache.ts'
import type { LmLoraItem } from 'src/host/loraManagerApi.ts'
import { lmItemKey, lmTrainedWords } from 'src/host/loraManagerApi.ts'
import { ComfyTS } from 'src/state.ts'
import { createMemoryStorage } from 'src/storage/ComfyStorage.ts'

/**
 * The real-collection check, which never ships a collection and never makes a
 * second copy of one. It reads a mirror that already exists locally —
 * `.comfy-ts/hosts/<id>/loras.json`, gitignored, written by `comfy-ts loras` —
 * and SKIPS ENTIRELY when there is none, so a clone and CI never run it.
 *
 * The rebuild below goes through an IN-MEMORY storage backend on purpose. An
 * earlier version used a temp directory: every `bun test` then left a full copy
 * of the inventory in `/tmp`, which no gitignore covers and nothing cleans.
 *
 * Why it exists: the overlay filter looks correct against a handful of invented
 * loras and falls apart on a real one. Subsequence matching over phrase-shaped
 * model names and sentence-shaped trigger words matches nearly everything, and
 * only a collection of realistic size makes that visible.
 */

function findLocalMirrors(): string[] {
   const hostsDir = join(process.cwd(), '.comfy-ts', 'hosts')
   if (!existsSync(hostsDir)) return []
   const out: string[] = []
   for (const entry of readdirSync(hostsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = join(hostsDir, entry.name, 'loras.json')
      if (existsSync(candidate)) out.push(candidate)
   }
   return out
}

const mirrors = findLocalMirrors()
const maybe = mirrors.length === 0 ? describe.skip : describe

maybe('real local lora corpus (skipped unless `comfy-ts loras` has run here)', () => {
   const items: LmLoraItem[] = []
   for (const path of mirrors) {
      const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
      const loras = (raw as { loras?: Record<string, LmLoraItem> }).loras ?? {}
      items.push(...Object.values(loras))
   }

   it('every entry keys uniquely — no two loras collide on `loraKey`', () => {
      const keys = items.map(lmItemKey).filter((k): k is string => k != null)
      expect(new Set(keys).size).toBe(keys.length)
   })

   it('trigger words are always strings, never an object the joiner would mangle', () => {
      for (const item of items) for (const word of lmTrainedWords(item)) expect(typeof word).toBe('string')
   })

   it('the filter stays SELECTIVE on a real collection (the regression that started this)', () => {
      // rebuild through the real read model, but ON MEMORY STORAGE: nothing this
      // test touches ever reaches a disk
      const globalHack = globalThis as { comfyts?: ComfyTS }
      const prior = globalHack.comfyts
      Reflect.deleteProperty(globalThis, 'comfyts')
      try {
         new ComfyTS({ rootPath: '/virtual', storage: createMemoryStorage() }).host({
            id: 'corpus',
            host: '127.0.0.1',
            port: 65496,
         })
         writeLoraMirror(buildLoraMirror({ hostId: 'corpus', hostUrl: '', fetchedAt: '', items }))
         reloadLoraInfoCache()
         const names = items.map((i) => lmItemKey(i)).filter((k): k is string => k != null)

         // take each lora's OWN file name as the filter: it must find that lora,
         // and a filter that specific must never drag a big slice of the
         // collection along. Measured on a real collection: substring rule max
         // 8 hits, mean 1.28 (families sharing a name stem legitimately
         // co-match), where the fuzzyMatch rule it replaced peaked at a third of
         // every lora present, for the same filters.
         let worst = 0
         let total = 0
         for (const name of names) {
            const hits = names.filter((n) => loraMatchesFilter(n, name.split('/').pop() ?? name, 'corpus'))
            expect(hits).toContain(name)
            worst = Math.max(worst, hits.length)
            total += hits.length
         }
         expect(worst).toBeLessThanOrEqual(Math.max(5, Math.ceil(names.length * 0.1)))
         expect(total / names.length).toBeLessThan(2)
      } finally {
         reloadLoraInfoCache()
         if (prior != null) globalHack.comfyts = prior
         else Reflect.deleteProperty(globalThis, 'comfyts')
      }
   })
})
