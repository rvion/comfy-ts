// a user-supplied filter (`v.loras(/krea2/gi)`) is reused across call sites. `RegExp.test` on a
// /g or /y regex advances lastIndex, so consecutive calls with the SAME pattern disagree: the
// picker offered a lora the payload validator then refused as unknown.
import { describe, expect, it } from 'bun:test'
import { matchesRegex } from 'src/utils/matchesRegex.ts'

describe('matchesRegex', () => {
   it('a /g regex gives the same answer every time', () => {
      const re = /krea2/gi
      const names = ['krea2-a', 'krea2-b', 'krea2-c']
      const first = names.filter((n) => matchesRegex(re, n))
      const second = names.filter((n) => matchesRegex(re, n))
      expect(first).toEqual(names)
      expect(second).toEqual(first)
   })

   it('the raw form is what it protects against', () => {
      const re = /krea2/gi
      const names = ['krea2-a', 'krea2-b', 'krea2-c']
      expect(names.filter((n) => re.test(n))).not.toEqual(names) // the bug, pinned
   })

   it('a sticky regex too', () => {
      const re = /a/y
      expect(matchesRegex(re, 'a')).toBe(true)
      expect(matchesRegex(re, 'a')).toBe(true)
   })

   it('an ordinary regex is untouched, flags and all', () => {
      expect(matchesRegex(/^KREA/i, 'krea2-a')).toBe(true)
      expect(matchesRegex(/^KREA/, 'krea2-a')).toBe(false)
      expect(matchesRegex(/a.c/s, 'a\nc')).toBe(true)
   })

   it('the source is not re-escaped: a pattern with slashes and classes still works', () => {
      expect(matchesRegex(/styles[\\/]x/g, 'styles\\x')).toBe(true)
      expect(matchesRegex(/styles[\\/]x/g, 'styles/x')).toBe(true)
   })
})
