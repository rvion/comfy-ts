import { describe, expect, it } from 'bun:test'
import { activeLoras, v, varValues } from 'src/vars/ComfyVars.ts'

describe('vars', () => {
   it('derives value types and snapshots values', () => {
      const vars = {
         prompt: v.text('hello'),
         seed: v.seed(42),
         steps: v.int(8, { min: 1, max: 40 }),
         on: v.toggle(true),
         ratio: v.choice(['a', 'b', 'c'] as const, 'b'),
      }
      const values = varValues(vars)
      expect(values).toEqual({ prompt: 'hello', seed: 42, steps: 8, on: true, ratio: 'b' })
      // typed: ratio is 'a'|'b'|'c'
      const ratio: 'a' | 'b' | 'c' = values.ratio
      expect(ratio).toBe('b')
   })

   it('int clamps to bounds, parse rejects garbage', () => {
      const steps = v.int(8, { min: 1, max: 40 })
      steps.set(999)
      expect(steps.value).toBe(40)
      expect(steps.parse('not-a-number')).toBe(false)
      expect(steps.parse('12')).toBe(true)
      expect(steps.value).toBe(12)
   })

   it('choice cycles and rejects unknown values', () => {
      const ratio = v.choice(['a', 'b', 'c'] as const, 'a')
      ratio.next()
      expect(ratio.value).toBe('b')
      ratio.next(-1)
      expect(ratio.value).toBe('a')
      expect(ratio.parse('nope')).toBe(false)
      expect(ratio.parse('c')).toBe(true)
   })

   it('prompt: // comments stripped, - lines become .negative, raw text kept for editor/drafts', () => {
      const p = v.prompt('// style notes\nmasterpiece\n- blurry\n  // wip line\nred hat\n- low-res, jpeg artifacts\n- ')
      expect(p.outValue()).toEqual({ positive: 'masterpiece\nred hat', negative: 'blurry, low-res, jpeg artifacts' })
      expect(p.value).toContain('// style notes') // editor + drafts keep the raw text
      expect(p.value).toContain('- blurry')
      expect(p.toJSON()).toBe(p.value)
      expect(varValues({ p }).p).toEqual({
         positive: 'masterpiece\nred hat',
         negative: 'blurry, low-res, jpeg artifacts',
      })
      // no negatives → empty string, callers can fall back (e.g. ConditioningZeroOut)
      expect(v.prompt('a cat').outValue()).toEqual({ positive: 'a cat', negative: '' })
      // '-dash' without a space is prompt text, not a negative
      expect(v.prompt('-dash text').outValue().positive).toBe('-dash text')
      // plain text vars are untouched
      const t = v.text('// not a comment here')
      expect(varValues({ t }).t).toBe('// not a comment here')
   })

   it('seed randomizes, toggle toggles, reset restores defaults', () => {
      const seed = v.seed(1)
      seed.randomize()
      expect(seed.value).not.toBe(1)
      seed.reset()
      expect(seed.value).toBe(1)
      const on = v.toggle(false)
      on.toggle()
      expect(on.value).toBe(true)
   })

   it('loras: toggle remembers strength, adjust clamps at 0, display lists actives', () => {
      const loras = v.loras(['a', 'b', 'c', 'd'], { a: 0.65, b: true, c: [0.8, 0.6] })
      expect(loras.display()).toBe('(3/4) a, b, c')
      // display strips subfolders + extension
      const pathy = v.loras(['styles\\Some Fancy Style v2.safetensors'], {
         'styles\\Some Fancy Style v2.safetensors': 1,
      })
      expect(pathy.display()).toBe('(1/1) Some Fancy Style v2')
      // selection is EMPTY by default (options are just the menu)
      expect(v.loras(['x', 'y']).display()).toBe('(0/2) none')
      expect(loras.isOn('d')).toBe(false)

      // untick keeps the old strength for re-tick
      loras.toggleItem('a')
      expect(loras.value.a).toBe(false)
      loras.toggleItem('a')
      expect(loras.value.a).toBe(0.65)
      // first tick of a never-on entry defaults to true
      loras.toggleItem('d')
      expect(loras.value.d).toBe(true)

      // adjust: true → 1+delta, tuple steps both, off is a no-op, floor at 0
      loras.adjustItem('b', 0.05)
      expect(loras.value.b).toBe(1.05)
      loras.adjustItem('c', -0.05)
      expect(loras.value.c).toEqual([0.75, 0.55])
      loras.toggleItem('d')
      loras.adjustItem('d', 0.05)
      expect(loras.value.d).toBe(false)
      loras.adjustItem('a', -5)
      expect(loras.value.a).toBe(0)

      expect(loras.strengthLabel('c')).toBe('m:0.75 c:0.55')
   })

   it('activeLoras normalizes every strength form for a LoraLoader chain', () => {
      const active = activeLoras({ a: true, b: 0.65, c: [0.8, 0.6], d: false, e: undefined })
      expect(active).toEqual([
         { lora_name: 'a', strength_model: 1, strength_clip: 1 },
         { lora_name: 'b', strength_model: 0.65, strength_clip: 0.65 },
         { lora_name: 'c', strength_model: 0.8, strength_clip: 0.6 },
      ])
   })

   it('size: parses WxH, matches presets in display', () => {
      const size = v.size()
      expect(size.value).toEqual({ width: 1024, height: 1024 })
      expect(size.display()).toBe('1024×1024 (1:1 square)')
      expect(size.parse('640 x 480')).toBe(true)
      expect(size.value).toEqual({ width: 640, height: 480 })
      expect(size.display()).toBe('640×480')
      expect(size.parse('garbage')).toBe(false)
      expect(size.parse('16:9 widescreen')).toBe(true)
      expect(size.value).toEqual({ width: 1344, height: 768 })
   })
})

describe('seed modes', () => {
   it('parses mode + number and round-trips through display/edit buffer', () => {
      const s = v.seed(12)
      expect(s.value).toBe(12)
      expect(s.mode).toBe('=')
      expect(s.display()).toBe('= 12')
      expect(s.toEditBuffer()).toBe('= 12')

      expect(s.parse('+')).toBe(true) // bare mode keeps the number
      expect(s.mode).toBe('+')
      expect(s.value).toBe(12)
      expect(s.parse('? 99')).toBe(true)
      expect(s.mode).toBe('?')
      expect(s.value).toBe(99)
      expect(s.parse('7')).toBe(true) // bare number => fixed
      expect(s.mode).toBe('=')
      expect(s.value).toBe(7)
      expect(s.parse('nope')).toBe(false)
   })

   it('advance() applies the mode; = is fixed, +/- step, ? rerolls', () => {
      const inc = v.seed(5)
      inc.parse('+')
      inc.advance()
      expect(inc.value).toBe(6)
      inc.advance()
      expect(inc.value).toBe(7)

      const dec = v.seed(2)
      dec.parse('-')
      dec.advance()
      expect(dec.value).toBe(1)
      dec.advance()
      dec.advance() // clamps at 0, never negative
      expect(dec.value).toBe(0)

      const fixed = v.seed(42)
      fixed.advance()
      expect(fixed.value).toBe(42)

      const rand = v.seed(0)
      rand.parse('?')
      rand.advance()
      // random 32-bit; overwhelmingly not 0 (deterministic assertion on type/range)
      expect(rand.value).toBeGreaterThanOrEqual(0)
      expect(rand.value).toBeLessThan(2 ** 32)
   })

   it('toJSON persists {mode, value}; loadJSON restores it (and legacy plain numbers)', () => {
      const s = v.seed(0)
      s.parse('+ 100')
      expect(s.toJSON()).toEqual({ mode: '+', value: 100 })

      const restored = v.seed(0)
      restored.loadJSON({ mode: '+', value: 100 })
      expect(restored.mode).toBe('+')
      expect(restored.value).toBe(100)

      const legacy = v.seed(0)
      legacy.loadJSON(517) // pre-mode drafts stored a bare number
      expect(legacy.mode).toBe('=')
      expect(legacy.value).toBe(517)
   })
})
