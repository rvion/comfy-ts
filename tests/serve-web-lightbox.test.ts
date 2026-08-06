// the lightbox used to capture a URL when you clicked. For a latent preview that url carries
// the frame tick, so opening one big froze it on that frame: later frames never showed, and
// the finished image never replaced it.
import { describe, expect, it } from 'bun:test'
import { lightboxView, type LightboxRun } from 'src/cli/serve/web/state/lightbox.ts'

const RESULT: LightboxRun = {
   module: 'wf',
   promptId: 'p1',
   images: [{ url: '/outputs/wf/out.png', filename: 'out.png' }],
}

describe('lightbox target', () => {
   it('a latent follows the live frame: the url moves with the tick', () => {
      const view = (previewTick: number): string =>
         lightboxView({ target: { kind: 'latent', module: 'wf' }, isRunning: true, previewTick, results: [] }).url
      expect(view(3)).not.toBe(view(4))
      expect(view(4)).toContain('/run/wf/preview')
   })

   it('when the run ends it PROMOTES itself to the image that run produced', () => {
      const view = lightboxView({
         target: { kind: 'latent', module: 'wf' },
         isRunning: false,
         previewTick: 9,
         results: [RESULT],
      })
      expect(view.url).toBe('/outputs/wf/out.png')
      expect(view.title).toBe('out.png')
      expect(view.promptId).toBe('p1')
   })

   it('another module finishing does not hijack it', () => {
      const view = lightboxView({
         target: { kind: 'latent', module: 'wf' },
         isRunning: false,
         previewTick: 2,
         results: [{ ...RESULT, module: 'other' }],
      })
      expect(view.title).toBe('latent preview')
   })

   it('an unservable image keeps the latent rather than blanking the view', () => {
      const view = lightboxView({
         target: { kind: 'latent', module: 'wf' },
         isRunning: false,
         previewTick: 2,
         results: [{ ...RESULT, images: [{ url: null, filename: 'out.png' }] }],
      })
      expect(view.title).toBe('latent preview')
   })

   it('an image target is exactly what you clicked, whatever the run does', () => {
      const view = lightboxView({
         target: { kind: 'image', url: '/outputs/old.png', title: 'old.png', promptId: 'p0' },
         isRunning: true,
         previewTick: 7,
         results: [RESULT],
      })
      expect(view).toEqual({ url: '/outputs/old.png', title: 'old.png', promptId: 'p0' })
   })
})
