import { describe, expect, it } from 'bun:test'
import { asLoraSort, sortLoraMatches } from 'src/cli/serve/web/state/loraSort.ts'

const names = [
   'styles\\b.safetensors',
   'a.safetensors',
   'styles\\c10.safetensors',
   'styles\\c9.safetensors',
   'z.safetensors',
]
const label = (n: string): string => n.split('\\').pop() ?? n

describe('lora popup sort', () => {
   it('folder keeps the host order untouched', () => {
      expect(sortLoraMatches({ names, mode: 'folder', label, addedAt: {} })).toEqual(names)
   })

   it('name sorts by display label, numbers in numeric order', () => {
      expect(sortLoraMatches({ names, mode: 'name', label, addedAt: {} }).map(label)).toEqual([
         'a.safetensors',
         'b.safetensors',
         'c9.safetensors',
         'c10.safetensors',
         'z.safetensors',
      ])
   })

   it('added puts the newest first and the undated last, undated keeping host order', () => {
      const addedAt = { 'a.safetensors': 100, 'styles\\c9.safetensors': 300, 'z.safetensors': 200 }
      expect(sortLoraMatches({ names, mode: 'added', label, addedAt })).toEqual([
         'styles\\c9.safetensors',
         'z.safetensors',
         'a.safetensors',
         'styles\\b.safetensors',
         'styles\\c10.safetensors',
      ])
   })

   it('an unknown stored mode falls back to folder', () => {
      expect(asLoraSort('added')).toBe('added')
      expect(asLoraSort('bogus')).toBe('folder')
      expect(asLoraSort(undefined)).toBe('folder')
   })
})
