import { describe, expect, it } from 'bun:test'
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'
import {
   asSeedForm,
   loraIsOn,
   loraStrengthPair,
   normalizeInitial,
   payloadSnapshot,
   pruneLorasRecord,
   setLoraEnabled,
   setLoraStrength,
} from 'src/cli/serve/web/state/payload.ts'

function desc(kind: VarDescriptor['kind'], extra: Partial<VarDescriptor> = {}): VarDescriptor {
   return { kind, payload: '', default: null, ...extra }
}

describe('web form value normalization', () => {
   it('seed: {mode,value} toJSON shape, legacy plain number, and garbage all normalize', () => {
      expect(asSeedForm({ mode: '+', value: 7 })).toEqual({ mode: '+', value: 7 })
      expect(asSeedForm(12)).toEqual({ mode: '=', value: 12 })
      expect(asSeedForm('nope')).toEqual({ mode: '=', value: 0 })
   })

   it('loras: keys the host no longer offers are pruned, so a stale draft entry cannot fail the build', () => {
      const options = ['a.safetensors', 'b.safetensors']
      expect(pruneLorasRecord({ 'a.safetensors': [1, 1], 'gone.safetensors': 0.8 }, options)).toEqual({
         'a.safetensors': [1, 1],
      })
      expect(pruneLorasRecord('garbage', options)).toEqual({})
      expect(normalizeInitial(desc('loras', { options }), { 'gone.safetensors': true })).toEqual({})
   })

   it('normalizeInitial falls back to the descriptor default when the draft misses the key', () => {
      expect(normalizeInitial(desc('seed', { default: { mode: '?', value: 3 } }), undefined)).toEqual({
         mode: '?',
         value: 3,
      })
      expect(normalizeInitial(desc('size', { default: { width: 512, height: 768 } }), undefined)).toEqual({
         width: 512,
         height: 768,
      })
      expect(normalizeInitial(desc('text', { default: 'hi' }), undefined)).toBe('hi')
      expect(normalizeInitial(desc('text', { default: 'hi' }), 'draft value')).toBe('draft value')
   })
})

describe('loras record transitions (LorasVar semantics, web side)', () => {
   it('switching OFF keeps the lora in the record (so the row keeps showing it)', () => {
      const off = setLoraEnabled({ 'a.safetensors': [0.8, 0.6] }, 'a.safetensors', false)
      expect(off).toEqual({ 'a.safetensors': false })
      expect(loraIsOn(off['a.safetensors'])).toBe(false)
      // still SELECTED: the key is present, which is what the ui lists
      expect('a.safetensors' in off).toBe(true)
   })

   it('switching back ON restores the remembered strength, not a bare 1', () => {
      const on = setLoraEnabled({ 'a.safetensors': false }, 'a.safetensors', true, { model: 0.8, clip: 0.6 })
      expect(on).toEqual({ 'a.safetensors': [0.8, 0.6] })
   })

   it('every stored strength shape reads back as a {model, clip} pair', () => {
      expect(loraStrengthPair([0.5, 0.25])).toEqual({ model: 0.5, clip: 0.25 })
      expect(loraStrengthPair(0.7)).toEqual({ model: 0.7, clip: 0.7 })
      expect(loraStrengthPair(true)).toEqual({ model: 1, clip: 1 })
      expect(loraStrengthPair(false)).toEqual({ model: 1, clip: 1 })
   })

   it('setLoraStrength writes both strengths as a pair', () => {
      expect(setLoraStrength({ a: true }, 'a', { model: 1.2, clip: 0.4 })).toEqual({ a: [1.2, 0.4] })
   })
})

describe('queued run payload', () => {
   it('freezes the values you saw, and leaves SEEDS to the server policy', () => {
      const payload = payloadSnapshot([
         { name: 'prompt', kind: 'prompt', value: 'a bear' },
         { name: 'seed', kind: 'seed', value: { mode: '?', value: 5 } },
         { name: 'steps', kind: 'int', value: 20 },
      ])
      expect(payload).toEqual({ prompt: 'a bear', steps: 20 })
      expect('seed' in payload).toBe(false)
   })
})
