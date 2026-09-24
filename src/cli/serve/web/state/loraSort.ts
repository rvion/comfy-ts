/** how the loras popup orders the cards the filter matched. `folder` keeps the host's own order
 * and groups by folder, the other modes list flat. The sort runs BEFORE the card cap, so a
 * lora the host listed last still makes the cut when it sorts first */
export type LoraSort = 'folder' | 'name' | 'added'

export const LORA_SORTS: readonly { mode: LoraSort; label: string; tip: string }[] = [
   { mode: 'folder', label: 'folder', tip: 'grouped by folder, in the order the host lists them' },
   { mode: 'name', label: 'name', tip: 'by display name, A to Z' },
   {
      mode: 'added',
      label: 'date added',
      tip: 'newest file first (the lora manager date). loras it has no date for come last',
   },
]

export function asLoraSort(raw: unknown): LoraSort {
   return raw === 'name' || raw === 'added' ? raw : 'folder'
}

export function sortLoraMatches(p: {
   names: readonly string[]
   mode: LoraSort
   label: (name: string) => string
   /** option → epoch seconds, entries only where the mirror has a date */
   addedAt: Record<string, number>
}): string[] {
   const out = [...p.names]
   if (p.mode === 'name')
      return out.sort((a, b) => p.label(a).localeCompare(p.label(b), undefined, { sensitivity: 'base', numeric: true }))
   if (p.mode === 'added')
      return out.sort((a, b) => {
         const ta = p.addedAt[a]
         const tb = p.addedAt[b]
         if (ta == null) return tb == null ? 0 : 1
         if (tb == null) return -1
         return tb - ta
      })
   return out
}

/** what the popup gallery draws: EVERY match, picked ones included, so picking a lora never
 * moves the cards around it. `enterPick` is the first card not picked yet, what enter adds */
export function popupCards(p: { matches: readonly string[]; picked: readonly string[]; cap: number }): {
   cards: string[]
   enterPick: string | null
} {
   const cards = p.matches.slice(0, p.cap)
   const picked = new Set(p.picked)
   return { cards, enterPick: cards.find((name) => !picked.has(name)) ?? null }
}

/** a popup card click: the first one adds, every later one pauses or resumes, the same switch as
 * the form card. Only the ✕ removes */
export function popupCardClick(p: { picked: boolean; on: boolean }): 'add' | 'pause' | 'resume' {
   if (!p.picked) return 'add'
   return p.on ? 'pause' : 'resume'
}
