import { describe, expect, it } from 'bun:test'
import { rewriteSaveNodesToWebsocket } from 'src/runner/ephemeral.ts'
import { MediaImage } from 'src/runner/MediaImage.ts'
import type { ComfyApiJson } from 'src/sdk-generator/comfy-api-json.ts'

// a real 1x1 transparent png (so image-meta can read the pathless filename's type)
const PNG_1X1 = Uint8Array.from(
   atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
   (c) => c.charCodeAt(0),
)

describe('ephemeral rewrite (SaveImage → SaveImageWebsocket)', () => {
   it('rewrites every SaveImage, drops filename_prefix, leaves the rest untouched', () => {
      const apiJson: ComfyApiJson = {
         '1': { class_type: 'KSampler', inputs: { seed: 42 } },
         '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'private/run' } },
         '3': { class_type: 'SaveImage', inputs: { images: ['1', 0] } },
      }
      const rewritten = rewriteSaveNodesToWebsocket(apiJson)
      expect(rewritten).toBe(2)
      expect(apiJson['1']).toEqual({ class_type: 'KSampler', inputs: { seed: 42 } })
      expect(apiJson['2']).toEqual({ class_type: 'SaveImageWebsocket', inputs: { images: ['1', 0] } })
      expect(apiJson['3']).toEqual({ class_type: 'SaveImageWebsocket', inputs: { images: ['1', 0] } })
   })

   it('a graph with no SaveImage reports 0 rewrites', () => {
      const apiJson: ComfyApiJson = { '1': { class_type: 'PreviewImage', inputs: {} } }
      expect(rewriteSaveNodesToWebsocket(apiJson)).toBe(0)
   })
})

describe('in-memory MediaImage (local saving off)', () => {
   it('holds its bytes with no path; filename derives from hash + metadata', () => {
      const img = new MediaImage({ buffer: PNG_1X1 })
      expect(img.absPath).toBeNull()
      expect(img.buffer).toBe(PNG_1X1)
      expect(img.filename).toMatch(/^image-[0-9a-f]{8}\.png$/)
      expect(img.getAsBlob().type).toBe('image/png')
   })

   it('freeBuffer is a no-op when the buffer is the only copy', () => {
      const img = new MediaImage({ buffer: PNG_1X1 })
      img.freeBuffer()
      expect(img.buffer).toBe(PNG_1X1)
   })

   it('a pathless MediaImage without a buffer throws loud', () => {
      expect(() => new MediaImage({})).toThrow(/requires a buffer/)
   })
})
