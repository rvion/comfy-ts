// ComfyUI sends live preview frames only when launched with `--preview-method` set to
// something other than its default `none`. The launch flags reach a client through
// `GET /system_stats` (`system.argv`), the one place a client can read them.

export type PreviewMethod = 'none' | 'auto' | 'latent2rgb' | 'taesd'

function isPreviewMethod(x: unknown): x is PreviewMethod {
   return x === 'none' || x === 'auto' || x === 'latent2rgb' || x === 'taesd'
}

/** the preview method a host was launched with, from its /system_stats payload. `'none'` when
 * the flag is absent (ComfyUI's default), null when the payload carries no argv to read (a cloud
 * host) or the flag holds a value this parser does not know */
export function previewMethodFromSystemStats(stats: unknown): PreviewMethod | null {
   if (stats == null || typeof stats !== 'object' || !('system' in stats)) return null
   const system = stats.system
   if (system == null || typeof system !== 'object' || !('argv' in system)) return null
   const argv = system.argv
   if (!Array.isArray(argv)) return null
   for (let i = 0; i < argv.length; i++) {
      const arg: unknown = argv[i]
      if (typeof arg !== 'string') continue
      const value =
         arg === '--preview-method' ? argv[i + 1] : arg.startsWith('--preview-method=') ? arg.slice(17) : undefined
      if (value === undefined) continue
      return isPreviewMethod(value) ? value : null
   }
   return 'none'
}
