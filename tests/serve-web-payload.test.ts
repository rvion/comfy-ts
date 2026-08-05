import { describe, expect, it } from 'bun:test'
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'
import { asSeedForm, buildPayload, normalizeInitial, type FormEntrySnapshot } from 'src/cli/serve/web/state/payload.ts'

function desc(kind: VarDescriptor['kind'], extra: Partial<VarDescriptor> = {}): VarDescriptor {
   return { kind, payload: '', default: null, ...extra }
}

function entry(name: string, kind: VarDescriptor['kind'], value: unknown, dirty: boolean): FormEntrySnapshot {
   return { name, desc: desc(kind), value, dirty }
}

describe('web form payload', () => {
   it('posts dirty vars only — the draft stays the base', () => {
      const payload = buildPayload([
         entry('prompt', 'prompt', 'a bear', true),
         entry('steps', 'int', 20, false),
         entry('cfg', 'float', 4.5, true),
      ])
      expect(payload).toEqual({ prompt: 'a bear', cfg: 4.5 })
   })

   it('a dirty seed posts a NUMBER, never a mode object (the server reroll branch needs the key absent)', () => {
      const payload = buildPayload([entry('seed', 'seed', { mode: '?', value: 42 }, true)])
      expect(payload).toEqual({ seed: 42 })
   })

   it('an untouched seed posts nothing, so the server seed policy applies', () => {
      expect(buildPayload([entry('seed', 'seed', { mode: '?', value: 42 }, false)])).toEqual({})
   })
})

describe('web form value normalization', () => {
   it('seed: {mode,value} toJSON shape, legacy plain number, and garbage all normalize', () => {
      expect(asSeedForm({ mode: '+', value: 7 })).toEqual({ mode: '+', value: 7 })
      expect(asSeedForm(12)).toEqual({ mode: '=', value: 12 })
      expect(asSeedForm('nope')).toEqual({ mode: '=', value: 0 })
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
