import { describe, expect, it } from 'bun:test'
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'
import {
   asSeedForm,
   loraStrengthPair,
   normalizeInitial,
   payloadSnapshot,
   loraIsOn,
   paletteOrder,
   pruneLorasRecord,
   reorderLoras,
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
   it('pausing marks the lora false and KEEPS its slot — deleting it moved the card in the row', () => {
      const off = setLoraEnabled({ 'a.safetensors': [0.8, 0.6], 'b.safetensors': 1 }, 'a.safetensors', false)
      expect(off).toEqual({ 'a.safetensors': false, 'b.safetensors': 1 })
      // `false` is LorasVar's own "selected but off": every reader skips it, and
      // normalizeInitial prunes it on load, so a draft still never accumulates dead keys
      expect(Object.keys(off)).toEqual(['a.safetensors', 'b.safetensors'])
      expect(loraIsOn(off['a.safetensors'])).toBe(false)
   })

   it('resuming restores the remembered strength, not a bare 1', () => {
      const on = setLoraEnabled({}, 'a.safetensors', true, { model: 0.8, clip: 0.6 })
      expect(on).toEqual({ 'a.safetensors': [0.8, 0.6] })
   })

   it('his repro: a draft full of `false` leftovers must not fill the palette', () => {
      // a real draft after ticking/unticking in the TUI: 4 keys, 1 on
      const draft = {
         'a.safetensors': false,
         'b.safetensors': [0.7, 0.7],
         'c.safetensors': false,
         'd.safetensors': false,
      }
      const options = ['a.safetensors', 'b.safetensors', 'c.safetensors', 'd.safetensors']
      expect(pruneLorasRecord(draft, options)).toEqual({ 'b.safetensors': [0.7, 0.7] })
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

describe('lora palette order', () => {
   const options = ['a', 'b', 'c', 'd']

   it('shows the record newest first', () => {
      expect(paletteOrder({ record: { a: 1, b: 1, c: 1 }, options, paused: new Set() })).toEqual(['c', 'b', 'a'])
   })

   it('PAUSING KEEPS THE POSITION: the whole point of writing false instead of deleting', () => {
      const record = { a: 1, b: 1, c: 1 }
      const before = paletteOrder({ record, options, paused: new Set() })
      const paused = setLoraEnabled(record, 'b', false)
      const after = paletteOrder({ record: paused, options, paused: new Set(['b']) })
      expect(before).toEqual(['c', 'b', 'a'])
      expect(after).toEqual(['c', 'b', 'a'])
      expect(paused.b).toBe(false)
      // resuming keeps it there too
      const resumed = setLoraEnabled(paused, 'b', true)
      expect(paletteOrder({ record: resumed, options, paused: new Set() })).toEqual(['c', 'b', 'a'])
   })

   it('a lora paused in a previous life (no longer in the record) still shows, at the end', () => {
      expect(paletteOrder({ record: { a: 1 }, options, paused: new Set(['d']) })).toEqual(['d', 'a'])
   })

   it('reordering rewrites the record key order, which IS the stored order', () => {
      const record = { a: 1, b: 1, c: 1 }
      const displayed = paletteOrder({ record, options, paused: new Set() }) // c, b, a
      const moved = reorderLoras({ record, displayed, from: 0, to: 2 }) // c goes last
      expect(paletteOrder({ record: moved, options, paused: new Set() })).toEqual(['b', 'a', 'c'])
      // the values ride along untouched
      expect(moved).toEqual({ c: 1, a: 1, b: 1 })
   })

   it('an out of range move changes nothing', () => {
      const record = { a: 1, b: 1 }
      const displayed = paletteOrder({ record, options, paused: new Set() })
      expect(reorderLoras({ record, displayed, from: 5, to: 0 })).toEqual(record)
   })
})
