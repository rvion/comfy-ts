import { describe, it, expect } from 'vitest'
import { Calculator, formatCurrency, validateEmail } from '../index'

describe('Calculator', () => {
   it('should add numbers correctly', () => {
      const calc = new Calculator()
      const result = calc.add(1, 2, 3)

      expect(result.value).toBe(6)
      expect(result.operation).toBe('add')
      expect(result.operands).toEqual([1, 2, 3])
   })

   it('should handle precision correctly', () => {
      const calc = new Calculator({ precision: 1 })
      const result = calc.add(0.1, 0.2)

      expect(result.value).toBe(0.3)
   })

   it('should throw error in strict mode with no operands', () => {
      const calc = new Calculator({ strict: true })

      expect(() => calc.add()).toThrow('At least one operand required')
   })
})

describe('formatCurrency', () => {
   it('should format USD correctly', () => {
      expect(formatCurrency(1234.56)).toBe('$1,234.56')
   })

   it('should format EUR correctly', () => {
      expect(formatCurrency(1234.56, 'EUR')).toBe('€1,234.56')
   })
})

describe('validateEmail', () => {
   it('should validate correct emails', () => {
      expect(validateEmail('test@example.com')).toBe(true)
      expect(validateEmail('user.name@domain.co.uk')).toBe(true)
   })

   it('should reject invalid emails', () => {
      expect(validateEmail('invalid')).toBe(false)
      expect(validateEmail('test@')).toBe(false)
      expect(validateEmail('@example.com')).toBe(false)
   })
})
