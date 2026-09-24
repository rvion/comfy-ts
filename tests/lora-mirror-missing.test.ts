import { describe, expect, it } from 'bun:test'
import { lorasMissingFromMirror } from 'src/host/loraInfoCache.ts'

describe('loras the local lora manager list does not know yet', () => {
   it('names only the ones the copy predates, so a schema refetch knows whether to re-read it', () => {
      const mirror = new Set(['old\\a.safetensors'])
      expect(lorasMissingFromMirror(['old\\a.safetensors', 'anima\\new.safetensors'], (n) => mirror.has(n))).toEqual([
         'anima\\new.safetensors',
      ])
   })

   it('an up to date copy asks for nothing', () => {
      expect(lorasMissingFromMirror(['a'], () => true)).toEqual([])
   })
})
