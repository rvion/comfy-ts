import { describe, expect, it } from 'bun:test'
import { comboOptions, diffSchemas, driftChanged, summarizeDrift } from 'src/host/schemaDrift.ts'

const loader = (input: string, options: string[], spelling: 'array' | 'combo' = 'array'): unknown => ({
   input: { required: { [input]: spelling === 'array' ? [options] : ['COMBO', { options }] } },
})

const loaded = {
   LoraLoader: loader('lora_name', ['a.safetensors', 'b.safetensors']),
   UNETLoader: loader('unet_name', ['old.safetensors', 'keep.safetensors']),
   KSampler: {},
}

describe('schema drift', () => {
   it('reads combo options in both object_info spellings', () => {
      expect(comboOptions({ X: loader('i', ['p']) }, 'X', 'i')).toEqual(['p'])
      expect(comboOptions({ X: loader('i', ['p'], 'combo') }, 'X', 'i')).toEqual(['p'])
      expect(comboOptions({}, 'X', 'i')).toBe(null)
   })

   it('a light check compares only the loaders the live side has, never node types', () => {
      const live = {
         LoraLoader: loader('lora_name', ['a.safetensors', 'b.safetensors', 'c.safetensors', 'd.safetensors'], 'combo'),
      }
      const d = diffSchemas({ loaded, live, full: false })
      expect(d.nodes).toBe(null)
      expect(d.models).toEqual([{ noun: 'lora', added: ['c.safetensors', 'd.safetensors'], removed: [] }])
      expect(summarizeDrift(d)).toBe('+2 loras')
   })

   it('a full check adds node types, and removals count too', () => {
      const live = {
         LoraLoader: loader('lora_name', ['a.safetensors', 'b.safetensors']),
         UNETLoader: loader('unet_name', ['keep.safetensors']),
         KSampler: {},
         TextEncodeQwenImage21: {},
      }
      const d = diffSchemas({ loaded, live, full: true })
      expect(summarizeDrift(d)).toBe('-1 unet, +1 node type')
      expect(driftChanged(d)).toBe(true)
   })

   it('an identical host is quiet', () => {
      const d = diffSchemas({ loaded, live: loaded, full: true })
      expect(driftChanged(d)).toBe(false)
      expect(summarizeDrift(d)).toBe('')
   })
})
