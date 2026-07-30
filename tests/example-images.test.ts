import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { imageMeta } from 'image-meta'
import { join } from 'pathe'
import {
   EXAMPLE_IMAGES,
   EXAMPLE_IMAGES_BUDGET_BYTES,
   EXAMPLE_IMAGES_DIR,
   parseImageName,
} from 'scripts/fetch-example-images.ts'

/**
 * the bundled examples/images/ contract (agent/examples.md): the manifest in
 * scripts/fetch-example-images.ts is the source of truth, filenames carry the
 * EXACT pixel size, and the committed folder stays under the tarball budget.
 * NO network here — the fetch itself is deliberate and manual.
 */
describe('example images manifest', () => {
   it('every row is <subject>_<W>x<H>.jpg with the size fields matching the filename', () => {
      for (const spec of EXAMPLE_IMAGES) {
         const parsed = parseImageName(spec.name)
         expect(parsed, `unparseable name: ${spec.name}`).not.toBeNull()
         expect({ name: spec.name, width: parsed?.width, height: parsed?.height }).toEqual({
            name: spec.name,
            width: spec.width,
            height: spec.height,
         })
         expect(spec.id).toBeGreaterThan(0)
      }
   })

   it('names and picsum ids are unique', () => {
      expect(new Set(EXAMPLE_IMAGES.map((s) => s.name)).size).toBe(EXAMPLE_IMAGES.length)
      expect(new Set(EXAMPLE_IMAGES.map((s) => s.id)).size).toBe(EXAMPLE_IMAGES.length)
   })

   it('covers the decided size set', () => {
      const sizes = EXAMPLE_IMAGES.map((s) => `${s.width}x${s.height}`).sort()
      expect(sizes).toEqual(['1024x1024', '1344x768', '200x300', '512x512', '768x1344', '768x768'])
   })

   it('every committed image exists with the exact decoded dimensions of its filename', () => {
      for (const spec of EXAMPLE_IMAGES) {
         const bytes = readFileSync(join(EXAMPLE_IMAGES_DIR, spec.name))
         const meta = imageMeta(bytes)
         expect({ name: spec.name, width: meta.width, height: meta.height }).toEqual({
            name: spec.name,
            width: spec.width,
            height: spec.height,
         })
      }
   })

   it('the whole folder fits the tarball budget', () => {
      const total = EXAMPLE_IMAGES.reduce(
         (sum, spec) => sum + readFileSync(join(EXAMPLE_IMAGES_DIR, spec.name)).length,
         0,
      )
      expect(total).toBeLessThanOrEqual(EXAMPLE_IMAGES_BUDGET_BYTES)
   })
})
