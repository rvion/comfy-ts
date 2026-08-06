// what the lightbox SHOWS, derived rather than captured. PURE and DOM-free on purpose:
// headless-tested by tests/serve-web-lightbox.test.ts.
import { runPreviewSrc } from 'src/cli/serve/web/api.ts'

/** an IMAGE target is a fixed file. A LATENT target names the running MODULE instead of a url,
 * because the url carries the frame tick: capturing it froze the lightbox on the frame you
 * happened to click, through every later frame and past the end of the run */
export type LightboxTarget =
   | { kind: 'image'; url: string; title: string; promptId: string | null }
   | { kind: 'latent'; module: string }

export type LightboxRun = {
   module: string
   promptId: string
   images: { url: string | null; filename: string }[]
}

export type LightboxView = { url: string; title: string; promptId: string | null }

/** a latent target follows the live frame, and the moment the run ends it promotes itself to
 * the image that run produced — watching a latent become the picture is the point of opening
 * it big, so stopping at the last frame loses exactly what you opened it for */
export function lightboxView(p: {
   target: LightboxTarget
   isRunning: boolean
   previewTick: number
   /** newest first */
   results: readonly LightboxRun[]
}): LightboxView {
   if (p.target.kind === 'image') return { url: p.target.url, title: p.target.title, promptId: p.target.promptId }
   const module = p.target.module
   const finished = p.results.find((r) => r.module === module)
   // an image with no url is one this run could not serve: stay on the latent rather than
   // blank the lightbox at the very moment the run pays off
   const image = finished?.images.find((i) => i.url != null)
   if (!p.isRunning && image?.url != null)
      return { url: image.url, title: image.filename, promptId: finished?.promptId ?? null }
   return { url: runPreviewSrc({ module, tick: p.previewTick }), title: 'latent preview', promptId: null }
}
