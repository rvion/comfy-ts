// what you submitted, kept for the life of the page: every prompt a generate sent, every text an
// enhance started from. In memory only, closing the page forgets it. PURE, headless-tested

export type HistoryEntry<V> = {
   /** what is searched and shown */
   text: string
   /** what a pick writes back (a prompt var holds a string or lanes) */
   value: V
   /** epoch ms of the LAST time this text was submitted */
   at: number
   /** where it was submitted from, shown dim: `04-krea2-turbo-t2i · prompt` */
   source: string
   /** how many times it was submitted */
   count: number
}

/** a generous bound: a long session stays searchable without the page growing without limit */
export const HISTORY_CAP = 1000

/** newest first, one entry per distinct text: submitting a text again moves it to the top */
export function pushHistory<V>(
   list: readonly HistoryEntry<V>[],
   next: { text: string; value: V; at: number; source: string },
): HistoryEntry<V>[] {
   if (next.text.trim() === '') return [...list]
   const seen = list.find((e) => e.text === next.text)
   const rest = list.filter((e) => e.text !== next.text)
   return [{ ...next, count: (seen?.count ?? 0) + 1 }, ...rest].slice(0, HISTORY_CAP)
}

/** every word of the query must appear in the text (any case, any order); newest first kept.
 * A letter by letter fuzzy match would hit nearly any long prompt, words find the one you mean */
export function searchHistory<V>(list: readonly HistoryEntry<V>[], query: string): HistoryEntry<V>[] {
   const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w !== '')
   if (words.length === 0) return [...list]
   return list.filter((e) => {
      const hay = `${e.text}\n${e.source}`.toLowerCase()
      return words.every((w) => hay.includes(w))
   })
}

export function timeAgo(at: number, now: number): string {
   const s = Math.max(0, Math.round((now - at) / 1000))
   if (s < 10) return 'just now'
   if (s < 60) return `${s}s ago`
   const m = Math.floor(s / 60)
   if (m < 60) return `${m} min ago`
   const h = Math.floor(m / 60)
   if (h < 24) return `${h} h ${m % 60} min ago`
   return `${Math.floor(h / 24)} d ago`
}
