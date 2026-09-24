/** the panel's jump keys, with ⌘ (ctrl elsewhere) and no other modifier. Each one works from ANY
 * focus, a prompt editor included: it is a jump, not an edit. Browser defaults they take over
 * (print, open file) are useless on this page */
export type Shortcut = 'focus-prompt' | 'open-loras' | 'toggle-blur'

export const SHORTCUT_KEYS: Record<Shortcut, string> = {
   'focus-prompt': 'P',
   'open-loras': 'O',
   'toggle-blur': 'B',
}

export function shortcutOf(e: {
   key: string
   metaKey: boolean
   ctrlKey: boolean
   altKey: boolean
   shiftKey: boolean
}): Shortcut | null {
   if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return null
   const key = e.key.toUpperCase()
   for (const [s, k] of Object.entries(SHORTCUT_KEYS) as [Shortcut, string][]) if (k === key) return s
   return null
}

/** which var each jump lands on: the FIRST var of that kind in the order shown, skipping one
 * that is disabled (it takes no focus) */
export function jumpTargets(vars: readonly { name: string; kind: string; inactive: boolean }[]): {
   prompt: string | null
   loras: string | null
} {
   const first = (kind: string): string | null => vars.find((v) => v.kind === kind && !v.inactive)?.name ?? null
   return { prompt: first('prompt'), loras: first('loras') }
}
