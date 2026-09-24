// size presets in the panel: which are starred (quick buttons before the list) and the tiny
// aspect rectangle each one draws. PURE, tests/serve-web-size-stars.test.ts

export type SizePresetLike = { label: string; width: number; height: number }

/** the starred presets, in PRESET order: your own stars when you set some, else the var's */
export function starredPresets<P extends SizePresetLike>(p: {
   presets: readonly P[]
   defaults: readonly string[]
   mine: readonly string[] | undefined
}): P[] {
   const stars = new Set(p.mine ?? p.defaults)
   return p.presets.filter((pr) => stars.has(pr.label))
}

/** flip one star, starting from whatever is effective right now */
export function toggleStar(p: {
   defaults: readonly string[]
   mine: readonly string[] | undefined
   label: string
}): string[] {
   const current = p.mine ?? p.defaults
   return current.includes(p.label) ? current.filter((l) => l !== p.label) : [...current, p.label]
}

/** the rectangle for an aspect icon: the long side fills `box`, the short one keeps the ratio */
export function aspectBox(width: number, height: number, box: number): { w: number; h: number } {
   if (width <= 0 || height <= 0) return { w: box, h: box }
   const scale = box / Math.max(width, height)
   return { w: Math.max(2, Math.round(width * scale)), h: Math.max(2, Math.round(height * scale)) }
}
