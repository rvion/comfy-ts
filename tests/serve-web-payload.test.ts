import { describe, expect, it } from 'bun:test'
import type { VarDescriptor } from 'src/cli/serve/describeVar.ts'
import {
   asSeedForm,
   loraStrengthPair,
   normalizeInitial,
   normalizeLorasInput,
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
   it('a paused lora survives a reload: still in the palette, still off, strengths kept', () => {
      // why we think it is actually a bug, and not just meaning spec should change: pausing is
      // "a few images without it, then back", and a reload in between silently dropped the lora
      const options = ['a.safetensors', 'b.safetensors']
      const paused = setLoraEnabled({ 'a.safetensors': [0.8, 0.6], 'b.safetensors': 1 }, 'a.safetensors', false)
      const reloaded = normalizeInitial(desc('loras', { options }), JSON.parse(JSON.stringify(paused)))
      expect(paletteOrder({ record: reloaded as Record<string, unknown>, options })).toEqual([
         'a.safetensors',
         'b.safetensors',
      ])
      const entry = (reloaded as Record<string, unknown>)['a.safetensors']
      expect(loraIsOn(entry)).toBe(false)
      expect(loraStrengthPair(entry)).toEqual({ model: 0.8, clip: 0.6 })
   })

   it('resuming brings back the strengths it had, not a bare 1', () => {
      const paused = setLoraEnabled({ a: [0.8, 0.6] }, 'a', false)
      expect(setLoraEnabled(paused, 'a', true)).toEqual({ a: [0.8, 0.6] })
   })

   it('a plain on lora keeps the short spelling, so an ordinary draft reads as before', () => {
      expect(setLoraEnabled({}, 'a', true)).toEqual({ a: [1, 1] })
      expect(setLoraStrength({ a: true }, 'a', { model: 1.2, clip: 0.4 })).toEqual({ a: [1.2, 0.4] })
   })

   it('a draft full of `false` leftovers must not fill the palette', () => {
      // a real draft after ticking/unticking in the TUI: 4 keys, 1 on. `false` is not a pause
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
      expect(loraStrengthPair({ strength: [0.3, 0.2], off: true })).toEqual({ model: 0.3, clip: 0.2 })
   })

   it('editing the strength of a paused lora keeps it paused', () => {
      const paused = setLoraEnabled({ a: 1 }, 'a', false)
      const edited = setLoraStrength(paused, 'a', { model: 0.5, clip: 0.5 })
      expect(loraIsOn(edited.a)).toBe(false)
      expect(loraStrengthPair(edited.a)).toEqual({ model: 0.5, clip: 0.5 })
   })
})

describe('lora palette order', () => {
   const options = ['a', 'b', 'c', 'd']

   it('a lora you add lands at the END of the row, so nothing already there moves', () => {
      // why we think it is actually a bug, and not just meaning spec should change: adding put
      // the new card first and shifted every card you were looking at
      expect(paletteOrder({ record: { a: 1, b: 1, c: 1 }, options })).toEqual(['a', 'b', 'c'])
      expect(paletteOrder({ record: { a: 1, b: 1, c: 1, d: 1 }, options }).slice(0, 3)).toEqual(['a', 'b', 'c'])
   })

   it('pausing and resuming keep the position', () => {
      const record = { a: 1, b: 1, c: 1 }
      const paused = setLoraEnabled(record, 'b', false)
      expect(paletteOrder({ record: paused, options })).toEqual(['a', 'b', 'c'])
      expect(paletteOrder({ record: setLoraEnabled(paused, 'b', true), options })).toEqual(['a', 'b', 'c'])
   })

   it('reordering rewrites the record key order, which IS the stored order', () => {
      const record = { a: 1, b: 1, c: 1 }
      const displayed = paletteOrder({ record, options })
      const moved = reorderLoras({ record, displayed, from: 0, to: 2 }) // a goes last
      expect(paletteOrder({ record: moved, options })).toEqual(['b', 'c', 'a'])
      expect(moved).toEqual({ b: 1, c: 1, a: 1 })
   })

   it('an out of range move changes nothing', () => {
      const record = { a: 1, b: 1 }
      const displayed = paletteOrder({ record, options })
      expect(reorderLoras({ record, displayed, from: 5, to: 0 })).toEqual(record)
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

describe('loras lanes on load', () => {
   it('every lane is pruned like a plain record, the lanes and their order stay', () => {
      const options = ['a', 'b']
      const loaded = normalizeLorasInput(
         {
            lanes: [
               { name: 'style', active: true, loras: { a: 1, gone: 1, b: false } },
               { name: 'detail', active: false, loras: { b: { strength: [0.5, 0.5], off: true } } },
            ],
         },
         options,
      )
      expect(loaded).toEqual({
         lanes: [
            { name: 'style', active: true, loras: { a: 1 } },
            { name: 'detail', active: false, loras: { b: { strength: [0.5, 0.5], off: true } } },
         ],
      })
   })

   it('control: a plain record still loads as a plain record', () => {
      expect(normalizeLorasInput({ a: [1, 1], b: false }, ['a', 'b'])).toEqual({ a: [1, 1] })
   })
})
