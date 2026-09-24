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
      expect(applyVarPayload(many, 42)).toContain('a list of')
      expect(applyVarPayload(v.choice(['a'], 'a'), null)).toContain('one of')
      expect(describeVar(many).select).toBe('many')
   })
})

describe('a choice that changed shape: older drafts and older open tabs', () => {
   // why we think it is actually a bug, and not just meaning spec should change: score became a
   // many choice while a tab still held the single choice; its autosave wrote '9' and every
   // submit failed with "expects a list". A single value means a list of one, it is not an error
   it('serve reads one value as a list of one', () => {
      const many = v.choice(['6', '7', '8', '9'], ['7'], { select: 'many' })
      expect(applyVarPayload(many, '9')).toBeNull()
      expect(many.value).toEqual(['9'])
      expect(applyVarPayload(many, 'zzz')).toContain('a list of')
   })

   it('a draft holding one value loads as a list of one, null as none', () => {
      const many = v.choice(['6', '7'], [], { select: 'many' })
      many.loadJSON('7')
      expect(many.value).toEqual(['7'])
      many.loadJSON(null)
      expect(many.value).toEqual([])
   })

   it('a list loads as a list, in the choices order', () => {
      const many = v.choice(['6', '7'], [], { select: 'many' })
      many.loadJSON(['7', '6'])
      expect(many.value).toEqual(['6', '7'])
   })
})
