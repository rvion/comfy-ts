import { describe, expect, it } from 'bun:test'
import { applyVarPayload } from 'src/cli/serve/applyVarPayload.ts'
import { describeVar } from 'src/cli/serve/describeVar.ts'
import { v } from 'src/vars/ComfyVars.ts'

describe('choice modes', () => {
   it('one: unchanged, the value is the option', () => {
      const c = v.choice(['a', 'b'], 'a', 'label')
      const value: 'a' | 'b' = c.value
      expect(value).toBe('a')
      expect(c.select).toBe('one')
   })

   it('zero or one: the value may be null, toggling the picked one clears it', () => {
      const c = v.choice(['6', '7'], '7', { select: 'zero-or-one' })
      const value: '6' | '7' | null = c.value
      expect(value).toBe('7')
      c.toggle('7')
      expect(c.value).toBeNull()
      expect(c.display()).toBe('none')
      expect(c.parse('6')).toBe(true)
      expect(c.value).toBe('6')
      expect(c.parse('')).toBe(true)
      expect(c.value).toBeNull()
   })

   it('many: the value is a list in the choices order', () => {
      const c = v.choice(['a', 'b', 'c'], ['c'], { select: 'many' })
      const value: ('a' | 'b' | 'c')[] = c.value
      expect(value).toEqual(['c'])
      c.toggle('a')
      expect(c.value).toEqual(['a', 'c'])
      expect(c.toEditBuffer()).toBe('a, c')
      expect(c.parse('b, c')).toBe(true)
      expect(c.value).toEqual(['b', 'c'])
      expect(c.parse('b, zzz')).toBe(false)
   })

   it('a default of the wrong shape is refused when the workflow is written', () => {
      // @ts-expect-error a many choice takes a list
      expect(() => v.choice(['a'], 'a', { select: 'many' })).toThrow('takes a list')
   })

   it('serve accepts each shape and refuses the others, the panel learns the mode', () => {
      const optional = v.choice(['6', '7'], '7', { select: 'zero-or-one' })
      expect(applyVarPayload(optional, null)).toBeNull()
      expect(optional.value).toBeNull()
      const many = v.choice(['a', 'b'], [], { select: 'many' })
      expect(applyVarPayload(many, ['b', 'a'])).toBeNull()
      expect(many.value).toEqual(['a', 'b'])
      expect(applyVarPayload(many, 'a')).toContain('a list of')
      expect(applyVarPayload(v.choice(['a'], 'a'), null)).toContain('one of')
      expect(describeVar(many).select).toBe('many')
   })
})
