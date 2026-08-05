import { describe, expect, it } from 'bun:test'
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'
import { asSeedForm, normalizeInitial, pruneLorasRecord } from 'src/cli/serve/web/state/payload.ts'

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
