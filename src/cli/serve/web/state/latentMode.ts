/** how a run's latent frames show: `full` in the running card at the top of the gallery, `corner`
 * in a small floating card so the last image stays in view until the next one lands, `off` none */
export type LatentMode = 'full' | 'corner' | 'off'

export const LATENT_MODES: readonly { mode: LatentMode; tip: string }[] = [
   { mode: 'full', tip: 'latent full size, in the running card at the top of the results' },
   {
      mode: 'corner',
      tip: 'latent small, in a corner: the last image stays where it is, the new one lands at once when done',
   },
   { mode: 'off', tip: 'no latent: a progress bar, then the image' },
]

/** a stored value → a mode. The blob held a boolean before the corner mode existed */
export function asLatentMode(raw: unknown): LatentMode {
   if (raw === 'full' || raw === 'corner' || raw === 'off') return raw
   if (raw === false) return 'off'
   return 'full'
}
