import { describe, expect, it } from 'bun:test'
import { looksLikeImage, loraPreviewKey } from 'src/host/loraManagerApi.ts'

describe('lora preview guard', () => {
   it('rejects the SPA index.html fallback (repro: <!doctype html> shown as a preview)', () => {
      const html = new TextEncoder().encode('<!doctype html><html lang="en"><head>…')
      expect(looksLikeImage(html)).toBe(false)
   })

   it('accepts real image magic numbers, rejects everything else', () => {
      expect(looksLikeImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe(true) // PNG
      expect(looksLikeImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true) // JPEG
      expect(looksLikeImage(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe(true) // GIF
      const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
      expect(looksLikeImage(webp)).toBe(true)
      expect(looksLikeImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBe(false) // RIFF but WAVE
      expect(looksLikeImage(new Uint8Array([]))).toBe(false)
      expect(looksLikeImage(new Uint8Array([0x00, 0x01]))).toBe(false)
   })

   it('loraPreviewKey normalizes slashes, extensions, case', () => {
      expect(loraPreviewKey('styles\\Fancy V2.safetensors')).toBe('styles/fancy v2')
      expect(loraPreviewKey('foo/bar.CKPT')).toBe('foo/bar')
   })
})
