import { describe, expect, it } from 'bun:test'
import { asLatentMode } from 'src/cli/serve/web/state/latentMode.ts'

describe('latent mode', () => {
   it('keeps a stored mode', () => {
      expect(asLatentMode('corner')).toBe('corner')
      expect(asLatentMode('off')).toBe('off')
      expect(asLatentMode('full')).toBe('full')
   })

   it('reads the old boolean: on was full size, off stays off', () => {
      expect(asLatentMode(true)).toBe('full')
      expect(asLatentMode(false)).toBe('off')
   })

   it('anything else is the default, full', () => {
      expect(asLatentMode(undefined)).toBe('full')
      expect(asLatentMode('big')).toBe('full')
   })
})
