import { describe, expect, it } from 'bun:test'
import crypto from 'node:crypto'
import { sha1Hex, sha1HexOfString } from 'src/utils/sha1.ts'

describe('pure-JS sha1 (must match node:crypto byte-for-byte — dedupe names depend on it)', () => {
   it('known vectors', () => {
      expect(sha1HexOfString('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
      expect(sha1HexOfString('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
      expect(sha1HexOfString('The quick brown fox jumps over the lazy dog')).toBe(
         '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12',
      )
   })

   it('matches node:crypto on random buffers across block boundaries', () => {
      // sizes chosen around the 64-byte block + length-padding edges
      for (const size of [0, 1, 54, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000, 65536]) {
         const buf = crypto.randomBytes(size)
         const expected = crypto.createHash('sha1').update(buf).digest('hex')
         expect(sha1Hex(new Uint8Array(buf))).toBe(expected)
      }
   })

   it('matches node:crypto on utf8 strings (preview-cache keys hash urls)', () => {
      for (const s of ['préviews/ünïcode.png', '日本語', 'a'.repeat(200), '/api/lm/previews/x.webp']) {
         const expected = crypto.createHash('sha1').update(s).digest('hex')
         expect(sha1HexOfString(s)).toBe(expected)
      }
   })
})
