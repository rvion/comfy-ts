// the open drafts as tabs: pure list operations, the store (WebSt) owns when they run
export type DraftTab = { module: string; draft: string }

/** where the serve process keeps them, under .comfy-ts/: draft names are private, so this file
 * must stay gitignored (tests/serve-tabs.test.ts runs git check-ignore on it) */
export const SERVE_TABS_FILE = 'serve-tabs.json'

const same = (a: DraftTab, b: DraftTab): boolean => a.module === b.module && a.draft === b.draft

/** a draft you open gets a tab at the end; one already open keeps its place */
export function openTab(tabs: readonly DraftTab[], t: DraftTab): readonly DraftTab[] {
   return tabs.some((x) => same(x, t)) ? tabs : [...tabs, { module: t.module, draft: t.draft }]
}

/** `next` is where to go: the right neighbour of the closed OPEN tab, else its left one, null
 * when the open tab stays. The last tab stays: a draft is always open */
export function closeTab(
   tabs: readonly DraftTab[],
   t: DraftTab,
   active: DraftTab | null,
): { tabs: readonly DraftTab[]; next: DraftTab | null } {
   const ix = tabs.findIndex((x) => same(x, t))
   if (ix < 0 || tabs.length <= 1) return { tabs, next: null }
   const rest = tabs.filter((_, i) => i !== ix)
   if (active == null || !same(active, t)) return { tabs: rest, next: null }
   return { tabs: rest, next: rest[Math.min(ix, rest.length - 1)] ?? null }
}

/** the renamed draft keeps the tab's place, even when the switch already opened it at the end */
export function renameTab(tabs: readonly DraftTab[], from: DraftTab, to: DraftTab): readonly DraftTab[] {
   const ix = tabs.findIndex((x) => same(x, from))
   const rest = tabs.filter((x) => !same(x, to))
   if (ix < 0) return openTab(rest, to)
   return rest.map((x) => (same(x, from) ? { module: to.module, draft: to.draft } : x))
}

/** ⌘1 to ⌘8 (ctrl elsewhere) the nth tab, ⌘9 the last one, as browsers do */
export function tabForKey(
   tabs: readonly DraftTab[],
   e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean },
): DraftTab | null {
   if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return null
   if (!/^[1-9]$/.test(e.key)) return null
   const n = Number(e.key)
   return (n === 9 ? tabs[tabs.length - 1] : tabs[n - 1]) ?? null
}

/** a stored list, shape-checked, keeping only drafts that still exist */
export function readTabs(raw: unknown, modules: readonly { module: string; drafts: readonly string[] }[]): DraftTab[] {
   if (!Array.isArray(raw)) return []
   const out: DraftTab[] = []
   for (const x of raw as unknown[]) {
      if (x == null || typeof x !== 'object') continue
      const o = x as { module?: unknown; draft?: unknown }
      if (typeof o.module !== 'string' || typeof o.draft !== 'string') continue
      const t = { module: o.module, draft: o.draft }
      if (!modules.some((m) => m.module === t.module && m.drafts.includes(t.draft))) continue
      if (!out.some((y) => same(y, t))) out.push(t)
   }
   return out
}
