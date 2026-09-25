import { describe, expect, it } from 'bun:test'
import { copyName } from 'src/utils/copyName.ts'

describe('copyName', () => {
   it('increments a trailing number instead of appending copy', () => {
      expect(copyName('portrait 3', [])).toBe('portrait 4')
      expect(copyName('v9', [])).toBe('v10')
      expect(copyName('take-1', [])).toBe('take-2')
   })

   it('keeps the zero padding of the number', () => {
      expect(copyName('shot 007', [])).toBe('shot 008')
      expect(copyName('shot 099', [])).toBe('shot 100')
   })

   it('skips numbers already taken', () => {
      expect(copyName('portrait 3', ['portrait 3', 'portrait 4', 'portrait 5'])).toBe('portrait 6')
   })

   it('appends copy when the name has no trailing number', () => {
      expect(copyName('portrait', [])).toBe('portrait copy')
      expect(copyName('portrait', ['portrait copy'])).toBe('portrait copy 2')
   })

   it('a name that is only a number increments too', () => {
      expect(copyName('12', ['12'])).toBe('13')
   })
})
