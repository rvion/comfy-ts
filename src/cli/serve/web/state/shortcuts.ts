/** the panel's jump keys, with ⌘ (ctrl elsewhere) and no other modifier except the ⇧ an entry
 * names. Each one works from ANY focus, a prompt editor included: it is a jump, not an edit.
 * Browser defaults they take over (print, open file) are useless on this page */
export type Shortcut = 'focus-prompt' | 'open-loras' | 'open-enhancer' | 'toggle-menu' | 'toggle-blur'

/** the letter as shown after ⌘; a leading ⇧ means shift is part of the chord */
export const SHORTCUT_KEYS: Record<Shortcut, string> = {
   'focus-prompt': 'P',
   'open-loras': 'O',
   // the same letter enhances once the enhancer is open (ENHANCER_KEYS): ⌘E, ⌘E
   'open-enhancer': 'E',
   // ⌘B is the sidebar key of every editor; the blur takes its shifted form
   'toggle-menu': 'B',
   'toggle-blur': '⇧B',
}

export function shortcutOf(e: {
   key: string
   metaKey: boolean
   ctrlKey: boolean
   altKey: boolean
   shiftKey: boolean
}): Shortcut | null {
   if (!(e.metaKey || e.ctrlKey) || e.altKey) return null
   const key = e.key.toUpperCase()
   for (const [s, k] of Object.entries(SHORTCUT_KEYS) as [Shortcut, string][]) {
      const shifted = k.startsWith('⇧')
      if (shifted === e.shiftKey && k.slice(shifted ? 1 : 0) === key) return s
   }
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

/** the enhancer's own keys, live only while it is open. Never ⌘⏎: that one generates everywhere,
 * and in the enhancer it generates with the rewrite (try, EnhancerSt.generateOverride) */
export type EnhancerShortcut = 'enhance' | 'apply'

export const ENHANCER_KEYS: Record<EnhancerShortcut, string> = { enhance: 'E', apply: 'I' }

export function enhancerShortcutOf(e: {
   key: string
   metaKey: boolean
   ctrlKey: boolean
   altKey: boolean
   shiftKey: boolean
}): EnhancerShortcut | null {
   if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return null
   const key = e.key.toUpperCase()
   for (const [s, k] of Object.entries(ENHANCER_KEYS) as [EnhancerShortcut, string][]) if (k === key) return s
   return null
}
