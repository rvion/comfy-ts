import { describe, expect, it } from 'bun:test'
import { overlayTopRight } from 'src/cli/tui/state/PreviewSt.ts'

const out = ['OOOOOOOOOO', 'OOOOOOOOOO', 'OOOOOOOOOO', 'OOOOOOOOOO'].join('\n')
// half-block lines carry escapes; visible width is what alignment must use
const latent = ['\x1b[38;2;1;2;3mLLL\x1b[0m', '\x1b[38;2;1;2;3mLLL\x1b[0m'].join('\n')

describe('overlayTopRight', () => {
   it('replaces the top rows whole, latent right-aligned to the panel width', () => {
      const composed = overlayTopRight(out, latent, 10)
      const lines = composed?.split('\n') ?? []
      expect(lines).toHaveLength(4)
      expect(lines[0]).toBe('       \x1b[38;2;1;2;3mLLL\x1b[0m')
      expect(lines[1]).toBe('       \x1b[38;2;1;2;3mLLL\x1b[0m')
      expect(lines[2]).toBe('OOOOOOOOOO')
      expect(lines[3]).toBe('OOOOOOOOOO')
   })

   it('no output yet: the small latent alone, still right-aligned', () => {
      const lines = overlayTopRight(null, latent, 10)?.split('\n') ?? []
      expect(lines).toHaveLength(2)
      expect(lines[0]).toBe('       \x1b[38;2;1;2;3mLLL\x1b[0m')
   })

   it('no latent yet: the output passes through untouched', () => {
      expect(overlayTopRight(out, null, 10)).toBe(out)
   })
})
