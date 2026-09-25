import { MOD_KEY } from 'src/cli/serve/web/components/modKey.ts'

/** the panel's jump keys, with ⌘ (ctrl elsewhere) and no other modifier except the ⇧ an entry
 * names, or a bare function key. Each one works from ANY focus, a prompt editor included: it is
 * a jump, not an edit. Browser defaults they take over (print, open file) are useless here */
export type Shortcut =
   | 'focus-prompt'
   | 'open-loras'
   | 'open-enhancer'
   | 'rename-draft'
   | 'duplicate-draft'
   | 'toggle-menu'
   | 'toggle-blur'

/** the letter as shown after ⌘; a leading ⇧ means shift is part of the chord. A function key
 * (F2) is pressed BARE, with no modifier: it is the rename key everywhere, and a free ⌘ letter
 * that is not already a browser key is hard to find */
export const SHORTCUT_KEYS: Record<Shortcut, string> = {
   'focus-prompt': 'P',
   'open-loras': 'O',
   // the same letter enhances once the enhancer is open (ENHANCER_KEYS): ⌘E, ⌘E
   'open-enhancer': 'E',
   // F2, as in every editor and the TUI; ⌘R stays the browser's reload
   'rename-draft': 'F2',
   // ⌘D: the browser's bookmark key, useless here
   'duplicate-draft': 'D',
   // ⌘B is the sidebar key of every editor
   'toggle-menu': 'B',
   'toggle-blur': 'U',
}

const isFunctionKey = (k: string): boolean => /^F\d{1,2}$/.test(k)

/** the key cap a hint shows: `⌘D`, or a bare `F2` */
export function shortcutLabel(s: Shortcut): string {
   const k = SHORTCUT_KEYS[s]
   return isFunctionKey(k) ? k : `${MOD_KEY}${k}`
}

/** ⌘K or ⌘J (ctrl elsewhere) opens the search over every workflow and draft */
export function isOmniboxKey(e: {
   key: string
   metaKey: boolean
   ctrlKey: boolean
   altKey: boolean
   shiftKey: boolean
}): boolean {
   return (
      (e.metaKey || e.ctrlKey) &&
      !e.altKey &&
      !e.shiftKey &&
      (e.key.toUpperCase() === 'K' || e.key.toUpperCase() === 'J')
   )
}

export function shortcutOf(e: {
   key: string
   metaKey: boolean
   ctrlKey: boolean
   altKey: boolean
   shiftKey: boolean
}): Shortcut | null {
   const bare = !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)
   for (const [s, k] of Object.entries(SHORTCUT_KEYS) as [Shortcut, string][])
      if (isFunctionKey(k) && bare && e.key === k) return s
   if (!(e.metaKey || e.ctrlKey) || e.altKey) return null
   const key = e.key.toUpperCase()
   for (const [s, k] of Object.entries(SHORTCUT_KEYS) as [Shortcut, string][]) {
      if (isFunctionKey(k)) continue
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
