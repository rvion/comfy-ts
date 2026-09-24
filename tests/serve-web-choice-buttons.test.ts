import { describe, expect, it } from 'bun:test'
import { acceptChoice, choiceAsButtons, clickChoice, pickedChoices } from 'src/cli/serve/web/state/choiceButtons.ts'

describe('choice vars: buttons or a select', () => {
   it('a few short options are buttons, one click each', () => {
      expect(choiceAsButtons(['turbo', 'aesthetic', 'base', 'base+turbo'])).toBe(true)
   })

   it('a long list stays a select', () => {
      expect(choiceAsButtons(['a', 'b', 'c', 'd', 'e', 'f'])).toBe(false)
   })

   it('one long label is enough to keep the select: buttons would wrap into a wall', () => {
      expect(choiceAsButtons(['qwen_3_4b.safetensors', 'ernie'])).toBe(false)
   })

   it('an empty choice list is not a row of zero buttons', () => {
      expect(choiceAsButtons([])).toBe(false)
   })
})

describe('choice modes', () => {
   const choices = ['6', '7', '8', '9']

   it('one: a click picks, clicking the lit one keeps it', () => {
      expect(clickChoice({ select: 'one', choices, value: '7', c: '8' })).toBe('8')
      expect(clickChoice({ select: 'one', choices, value: '7', c: '7' })).toBe('7')
   })

   it('zero or one: clicking the lit one clears it', () => {
      expect(clickChoice({ select: 'zero-or-one', choices, value: '7', c: '7' })).toBeNull()
      expect(clickChoice({ select: 'zero-or-one', choices, value: null, c: '9' })).toBe('9')
   })

   it('many: each click toggles, the list keeps the choices order', () => {
      expect(clickChoice({ select: 'many', choices, value: ['9'], c: '6' })).toEqual(['6', '9'])
      expect(clickChoice({ select: 'many', choices, value: ['6', '9'], c: '9' })).toEqual(['6'])
      expect(clickChoice({ select: 'many', choices, value: [], c: '7' })).toEqual(['7'])
   })

   it('what is lit, for every shape', () => {
      expect(pickedChoices('7')).toEqual(['7'])
      expect(pickedChoices(null)).toEqual([])
      expect(pickedChoices(['6', '9'])).toEqual(['6', '9'])
   })

   it('a value from outside is held to the shape and the list', () => {
      expect(acceptChoice({ select: 'many', choices, raw: ['9', '6'] })).toEqual({ ok: true, value: ['6', '9'] })
      expect(acceptChoice({ select: 'many', choices, raw: ['5'] })).toEqual({ ok: false })
      expect(acceptChoice({ select: 'zero-or-one', choices, raw: null })).toEqual({ ok: true, value: null })
      expect(acceptChoice({ select: 'one', choices, raw: null })).toEqual({ ok: false })
   })
})
