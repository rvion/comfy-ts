import { describe, expect, it } from 'bun:test'
import { asLatentMode, LATENT_MODES } from 'src/cli/serve/web/state/latentMode.ts'

describe('latent mode', () => {
   it('keeps a stored mode', () => {
      expect(asLatentMode('corner')).toBe('corner')
      expect(asLatentMode('off')).toBe('off')
      expect(asLatentMode('full')).toBe('full')
   })

   it('reads the old boolean: on was the old default and takes the new one, off stays off', () => {
      expect(asLatentMode(true)).toBe('corner')
      expect(asLatentMode(false)).toBe('off')
   })

   it('anything else is the default, the small corner latent', () => {
      expect(asLatentMode(undefined)).toBe('corner')
      expect(asLatentMode('big')).toBe('corner')
   })

   it('the corner mode is the first button', () => {
      expect(LATENT_MODES[0]?.mode).toBe('corner')
   })
})
